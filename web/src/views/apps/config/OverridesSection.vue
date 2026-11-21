<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listBindings, listEnvironments, MockError, updateAppBinding } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { AppConfig, Binding, Environment } from '@/types'

interface OverrideDraft {
  replicaCount: number
  host: string
}

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))

const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const config = ref<AppConfig | null>(null)
const selectedId = ref('')
const drafts = ref<Record<string, OverrideDraft>>({})
const draft = reactive<OverrideDraft>({ replicaCount: 1, host: '' })
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref(false)
const savedLocally = ref(false)
const staleBase = ref(false)

const currentBinding = computed<Binding | null>(
  () => bindings.value.find((item) => item.id === selectedId.value) ?? null,
)
const baseline = computed<OverrideDraft>(() => {
  const binding = currentBinding.value
  const values = config.value?.deployValues ?? {}
  return {
    replicaCount: binding?.overrideValues.replicaCount ?? values.replicaCount ?? 1,
    host: binding?.overrideValues.host ?? values.host ?? '',
  }
})
const dirty = computed(
  () => draft.replicaCount !== baseline.value.replicaCount || draft.host !== baseline.value.host,
)
const noticeMessage = computed(
  () =>
    `已保存到环境绑定 ${selectedId.value || '{bindingId}'}（PUT /apps/${appId.value || '{appId}'}/environments/${selectedId.value || '{bindingId}'}）`,
)
const baseEmpty = computed(
  () => config.value !== null && Object.keys(config.value.deployValues).length === 0,
)
const baseRows = computed<Array<{ label: string; value: string }>>(() => {
  const values = config.value?.deployValues ?? {}
  const rows: Array<{ label: string; value: string }> = [
    { label: '副本数', value: values.replicaCount === undefined ? '—' : String(values.replicaCount) },
    { label: '容器端口', value: values.containerPort === undefined ? '—' : String(values.containerPort) },
    { label: '访问域名', value: values.host ?? '—' },
  ]
  if (values.job) {
    rows.push({ label: 'Job backoffLimit', value: String(values.job.backoffLimit) })
    rows.push({ label: 'Job activeDeadlineSeconds', value: String(values.job.activeDeadlineSeconds) })
  }
  if (values.env) rows.push({ label: '环境变量', value: Object.keys(values.env).join('、') })
  return rows
})
const targetRows = computed<Array<{ label: string; value: string }>>(() => {
  const binding = currentBinding.value
  if (!binding) return []
  return [
    { label: '集群', value: binding.target.clusterId },
    { label: 'Namespace', value: binding.target.namespace },
    { label: 'releaseName', value: binding.target.releaseName },
  ]
})

function environmentName(envId: string): string {
  const env = environments.value.find((item) => item.id === envId)
  return env ? env.name : envId
}

function isProduction(envId: string): boolean {
  return environments.value.find((item) => item.id === envId)?.production ?? false
}

function syncDraft(): void {
  const binding = currentBinding.value
  const stored = binding ? drafts.value[binding.id] : undefined
  const next: OverrideDraft = stored ?? {
    replicaCount: baseline.value.replicaCount,
    host: baseline.value.host,
  }
  draft.replicaCount = next.replicaCount
  draft.host = next.host
}

function persistDraft(): void {
  const binding = currentBinding.value
  if (!binding) return
  drafts.value = {
    ...drafts.value,
    [binding.id]: { replicaCount: draft.replicaCount, host: draft.host },
  }
}

function selectBinding(bindingId: string): void {
  if (bindingId === selectedId.value) return
  persistDraft()
  selectedId.value = bindingId
  notice.value = false
  staleBase.value = false
  syncDraft()
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  notice.value = false
  savedLocally.value = false
  staleBase.value = false
  try {
    const [bindingList, envList, cfg] = await Promise.all([
      listBindings(appId.value),
      listEnvironments(),
      getConfig(appId.value),
    ])
    bindings.value = bindingList
    environments.value = envList
    config.value = cfg
    drafts.value = {}
    selectedId.value = bindingList[0]?.id ?? ''
    syncDraft()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '环境覆盖加载失败'
  } finally {
    loading.value = false
  }
}

async function handleSave(): Promise<void> {
  const binding = currentBinding.value
  if (!binding) return
  saving.value = true
  notice.value = false
  staleBase.value = false
  try {
    const updated = await updateAppBinding(appId.value, binding.id, {
      expectedVersion: binding.version,
      overrideValues: {
        ...binding.overrideValues,
        replicaCount: draft.replicaCount,
        host: draft.host,
      },
    })
    bindings.value = bindings.value.map((item) => (item.id === updated.id ? updated : item))
    drafts.value = { ...drafts.value, [updated.id]: { replicaCount: draft.replicaCount, host: draft.host } }
    savedLocally.value = false
    notice.value = true
    MessagePlugin.success(`已保存环境覆盖（绑定版本 v${updated.version}）`)
  } catch (err) {
    if (err instanceof MockError && err.code === 'revision_conflict') {
      staleBase.value = true
      MessagePlugin.warning(err.message)
      await load()
    } else {
      MessagePlugin.error(err instanceof Error ? err.message : '环境覆盖保存失败')
    }
  } finally {
    saving.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="sec">
    <PageHeader
      title="环境覆盖"
      description="按环境覆盖基础部署值；继承值来自基础部署配置，覆盖值只作用于当前环境绑定。"
    >
      <template #actions>
        <t-tag v-if="savedLocally" theme="warning" variant="light">本地草稿</t-tag>
        <span v-if="dirty" class="hint-dirty">有未保存修改</span>
        <t-button
          theme="primary"
          :loading="saving"
          :disabled="loading || currentBinding === null"
          @click="handleSave"
        >
          <template #icon><t-icon name="save" /></template>
          保存覆盖
        </t-button>
      </template>
    </PageHeader>

    <t-alert v-if="notice" theme="info" :message="noticeMessage" />
    <p v-if="notice" class="u-dim ov__notice">
      已写入该环境绑定，切换环境会重新读取各自绑定的覆盖值。
    </p>
    <t-alert
      v-if="staleBase"
      theme="warning"
      title="基础配置已更新"
      message="继承的基础部署值已刷新为最新版本，请确认覆盖项后再发布。"
    />

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <div v-else-if="bindings.length === 0" class="tk-panel">
      <EmptyState
        icon="info-circle"
        title="尚未绑定环境"
        description="该应用还没有环境绑定；先在应用概览中完成环境绑定，才能配置按环境覆盖值。"
      />
    </div>

    <template v-else>
      <div class="tk-tabs-bar ov__tabs">
        <button
          v-for="binding in bindings"
          :key="binding.id"
          type="button"
          class="tk-tab ov__tab"
          :class="{ 'tk-tab--active': binding.id === selectedId }"
          @click="selectBinding(binding.id)"
        >
          <span>{{ environmentName(binding.environmentId) }}</span>
          <t-tag v-if="isProduction(binding.environmentId)" theme="danger" variant="light" size="small">生产</t-tag>
        </button>
      </div>

      <div class="ov">
        <div class="ov__col">
          <section class="tk-panel">
            <div class="tk-panel__head">
              <span>继承的基础配置</span>
              <span class="u-dim">只读 · {{ config ? `配置版本 v${config.version}` : '—' }}</span>
            </div>
            <div class="tk-panel__body">
              <EmptyState
                v-if="baseEmpty"
                compact
                icon="info-circle"
                title="基础部署值还是空的"
                description="先到「基础部署配置」保存一次，覆盖项才会继承到该环境。"
              />
              <dl v-else class="tk-kv">
                <template v-for="row in baseRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd class="u-mono">{{ row.value }}</dd>
                </template>
              </dl>
            </div>
          </section>

          <section class="tk-panel">
            <div class="tk-panel__head">
              <span>环境目标</span>
              <span class="u-dim">{{ currentBinding ? `binding v${currentBinding.version}` : '—' }}</span>
            </div>
            <div class="tk-panel__body">
              <dl class="tk-kv">
                <template v-for="row in targetRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd class="u-mono">{{ row.value }}</dd>
                </template>
              </dl>
              <p class="u-dim ov__note">
                {{ currentBinding ? `binding ${currentBinding.id}` : '未选择绑定' }} · 集群与 Namespace
                由环境绑定决定，不可在此修改。
              </p>
            </div>
          </section>
        </div>

        <div class="ov__col">
          <section class="tk-panel">
            <div class="tk-panel__head">
              <span>覆盖项</span>
              <span class="u-dim">留空或沿用默认值表示不覆盖</span>
            </div>
            <div class="tk-panel__body">
              <div class="fld-grid">
                <div class="fld">
                  <span class="fld__label">副本数</span>
                  <t-input-number v-model="draft.replicaCount" :min="1" :max="50" theme="normal" />
                  <span class="u-dim">继承值 {{ baseline.replicaCount }}；该值只覆盖本环境。</span>
                </div>
                <div class="fld">
                  <span class="fld__label">访问域名（host）</span>
                  <t-input v-model="draft.host" placeholder="checkout.staging.acme.dev" />
                  <span class="u-dim">留空表示沿用基础配置中的 host。</span>
                </div>
              </div>
            </div>
          </section>

          <section class="tk-panel">
            <div class="tk-panel__head"><span>说明</span></div>
            <div class="tk-panel__body">
              <ul class="tips">
                <li>
                  <t-icon name="info-circle" />
                  <span>覆盖项只影响当前绑定，不影响其它环境。</span>
                </li>
                <li>
                  <t-icon name="info-circle" />
                  <span>继承值来自基础部署配置，修改基础值会刷新继承值。</span>
                </li>
                <li>
                  <t-icon name="lock-on" />
                  <span>保存会写入环境绑定并递增绑定版本；并发修改会提示冲突并要求重新读取。</span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sec__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}
.hint-dirty {
  color: var(--tk-warning);
}
.ov__tabs {
  gap: 16px;
}
.ov__tab {
  gap: 6px;
  padding: 0;
  font: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
.ov {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.ov__col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.ov__note {
  margin: 10px 0 0;
}
.ov__notice {
  margin: -4px 0 0;
}
.fld-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.fld__label {
  color: var(--tk-text-2);
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--tk-text-2);
}
.tips li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 18px;
}
.tips .t-icon {
  flex: none;
  margin-top: 2px;
  color: var(--tk-text-3);
}
@media (max-width: 1180px) {
  .ov {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
