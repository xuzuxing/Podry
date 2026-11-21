<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listRegistries, MockError, saveConfig } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { AppConfig, BuildConfig, Registry } from '@/types'

interface BuildForm {
  registryId: string
  imageRepository: string
  dockerfile: string
  context: string
  platform: 'linux/amd64' | 'linux/arm64'
  timeoutSeconds: number
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

const platformOptions = [
  { label: 'linux/amd64', value: 'linux/amd64' },
  { label: 'linux/arm64', value: 'linux/arm64' },
]

const config = ref<AppConfig | null>(null)
const registries = ref<Registry[]>([])
const form = ref<BuildForm>(blankForm())
const saved = ref<BuildForm>(blankForm())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)

function blankForm(): BuildForm {
  return {
    registryId: '',
    imageRepository: '',
    dockerfile: 'Dockerfile',
    context: '.',
    platform: 'linux/amd64',
    timeoutSeconds: 1800,
  }
}

const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value))
const savedReady = computed(() => config.value?.buildConfig !== null && config.value?.buildConfig !== undefined)
const registryOptions = computed(() =>
  registries.value.map((item) => ({ label: `${item.name} · ${item.endpoint}`, value: item.id })),
)
const currentRegistry = computed(() => registries.value.find((item) => item.id === form.value.registryId) ?? null)
const imagePreview = computed(() => {
  const repository = form.value.imageRepository.trim()
  if (!repository) return '填写 Repository 后显示推送地址'
  const endpoint = (currentRegistry.value?.endpoint ?? '').replace(/^https?:\/\//, '')
  return `${endpoint ? `${endpoint}/` : ''}${repository}:<build-tag>`
})

function fill(next: BuildForm): void {
  form.value = { ...next }
  saved.value = { ...next }
}

function pathError(label: string, value: string): string {
  const text = value.trim()
  if (!text) return `请填写${label}`
  if (text.startsWith('/')) return `${label}不能以 / 开头（应为仓库内相对路径）`
  if (text.includes('..')) return `${label}不能包含 ..`
  return ''
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  conflict.value = false
  errors.value = {}
  try {
    const [cfg, registryList] = await Promise.all([getConfig(appId.value), listRegistries()])
    config.value = cfg
    registries.value = registryList
    fill(
      cfg.buildConfig
        ? { ...cfg.buildConfig }
        : { ...blankForm(), imageRepository: '', registryId: registryList[0]?.id ?? '' },
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : '构建配置加载失败'
  } finally {
    loading.value = false
  }
}

function validate(): boolean {
  const next: Record<string, string> = {}
  if (!form.value.registryId) next.registryId = '请选择镜像仓库'
  const repository = form.value.imageRepository.trim()
  if (!repository) next.imageRepository = '请填写镜像 Repository'
  else if (repository.startsWith('/')) next.imageRepository = 'Repository 不能以 / 开头'
  const dockerfileError = pathError('Dockerfile 路径', form.value.dockerfile)
  if (dockerfileError) next.dockerfile = dockerfileError
  const contextError = pathError('Context 路径', form.value.context)
  if (contextError) next.context = contextError
  if (!Number.isFinite(form.value.timeoutSeconds) || form.value.timeoutSeconds <= 0) {
    next.timeoutSeconds = '构建超时需为正整数（秒）'
  }
  errors.value = next
  return Object.keys(next).length === 0
}

async function goNext(): Promise<void> {
  const ok = await save()
  if (!ok) return
  await router.push({ name: 'config-base', params: { projectId: route.params.projectId, appId: appId.value } })
}

async function save(): Promise<boolean> {
  if (!config.value || !validate()) return false
  saving.value = true
  conflict.value = false
  try {
    const payload: BuildConfig = {
      registryId: form.value.registryId,
      imageRepository: form.value.imageRepository.trim(),
      dockerfile: form.value.dockerfile.trim(),
      context: form.value.context.trim(),
      platform: form.value.platform,
      timeoutSeconds: Math.round(form.value.timeoutSeconds),
    }
    const updated = await saveConfig(appId.value, {
      section: 'build',
      expectedVersion: config.value.version,
      buildConfig: payload,
    })
    config.value = updated
    fill(payload)
    MessagePlugin.success(`已保存（配置版本 v${updated.version}）`)
    return true
  } catch (err) {
    if (err instanceof MockError && err.code === 'revision_conflict') conflict.value = true
    else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="sec">
    <PageHeader title="构建配置" description="定义镜像产出位置与构建上下文；路径均为仓库内相对路径。">
      <template #actions>
        <span v-if="dirty" class="hint-dirty">有未保存修改</span>
        <t-button variant="outline" :loading="saving" :disabled="loading || config === null || !savedReady" @click="goNext">
          保存并下一步
        </t-button>
        <t-button theme="primary" :loading="saving" :disabled="loading || config === null" @click="save">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </template>
    </PageHeader>

    <t-alert
      v-if="conflict"
      theme="warning"
      title="配置已被他人更新"
      message="当前表单仍保留你的输入；重新读取会以服务端版本覆盖本地改动。"
    >
      <template #operation>
        <t-button size="small" variant="outline" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          重新读取
        </t-button>
      </template>
    </t-alert>

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <t-alert
        v-if="registries.length === 0"
        theme="warning"
        title="尚未接入镜像仓库"
        message="请先在「平台设置 → 镜像仓库」中登记仓库，保存构建配置前必须选择仓库。"
      />

      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>镜像</span>
          <span class="u-dim">配置版本 {{ versionText }}</span>
        </div>
        <div class="tk-panel__body">
          <div class="fld-grid">
            <div class="fld">
              <span class="fld__label">镜像仓库 <em>*</em></span>
              <t-select v-model="form.registryId" :options="registryOptions" placeholder="选择镜像仓库" clearable />
              <span v-if="errors.registryId" class="fld__err">{{ errors.registryId }}</span>
              <span class="u-dim">推送凭据由仓库自身的凭据引用决定，此处不做选择。</span>
            </div>
            <div class="fld">
              <span class="fld__label">镜像 Repository <em>*</em></span>
              <t-input v-model="form.imageRepository" placeholder="acme/checkout-api" />
              <span v-if="errors.imageRepository" class="fld__err">{{ errors.imageRepository }}</span>
              <span class="u-dim u-ellipsis">推送地址：{{ imagePreview }}</span>
            </div>
            <div v-if="registries.length === 0" class="fld fld--wide">
              <EmptyState
                compact
                icon="info-circle"
                title="暂无可用镜像仓库"
                description="登记仓库后返回本分区即可选择；未选择仓库无法保存构建配置。"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>构建定义</span>
          <span class="u-dim">Dockerfile 与 Context 都相对仓库根目录</span>
        </div>
        <div class="tk-panel__body">
          <div class="fld-grid">
            <div class="fld">
              <span class="fld__label">Dockerfile 路径 <em>*</em></span>
              <t-input v-model="form.dockerfile" placeholder="docker/Dockerfile" />
              <span v-if="errors.dockerfile" class="fld__err">{{ errors.dockerfile }}</span>
              <span class="u-dim">例如 docker/Dockerfile；不能以 / 开头，也不能包含 ..。</span>
            </div>
            <div class="fld">
              <span class="fld__label">Context 路径 <em>*</em></span>
              <t-input v-model="form.context" placeholder="." />
              <span v-if="errors.context" class="fld__err">{{ errors.context }}</span>
              <span class="u-dim">构建上下文目录，通常为 . 或 docker。</span>
            </div>
            <div class="fld">
              <span class="fld__label">目标平台</span>
              <t-select v-model="form.platform" :options="platformOptions" />
              <span class="u-dim">单平台构建；跨平台镜像需在流水线中分别构建。</span>
            </div>
            <div class="fld">
              <span class="fld__label">构建超时（秒） <em>*</em></span>
              <t-input-number
                v-model="form.timeoutSeconds"
                :min="60"
                :max="86400"
                :step="60"
                theme="normal"
                placeholder="1800"
              />
              <span v-if="errors.timeoutSeconds" class="fld__err">{{ errors.timeoutSeconds }}</span>
              <span class="u-dim">超时后构建 Job 被终止，可在构建历史中看到失败原因。</span>
            </div>
          </div>
        </div>
      </section>
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
.fld--wide {
  grid-column: 1 / -1;
}
.fld__label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--tk-text-2);
}
.fld__label em {
  color: var(--tk-danger);
  font-style: normal;
}
.fld__err {
  color: var(--tk-danger);
  font-size: 11px;
  line-height: 16px;
}
</style>
