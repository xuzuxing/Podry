<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { SelectValue } from 'tdesign-vue-next'
import { useRouter } from 'vue-router'

import { confirmDeployment, importArtifact, MockError, previewDeployment } from '@/api'
import type { DeploymentPreview } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import type { Artifact, Binding, DeployStrategy, Deployment, Environment } from '@/types'
import { fmtTime, shortDigest } from '@/utils/format'

const props = defineProps<{
  visible: boolean
  appId: string
  projectId: string
  bindingId: string
  bindings: Binding[]
  environments: Environment[]
  artifacts: Artifact[]
  deployments: Deployment[]
  configVersion: number
}>()

const emit = defineEmits<{ 'update:visible': [value: boolean]; refresh: [] }>()

const router = useRouter()

const targetBindingId = ref('')
const selectedArtifactId = ref('')
const search = ref('')

/* P2：发布策略 rolling / canary / bluegreen */
const strategy = ref<DeployStrategy>('rolling')
const canaryStepsInput = ref('20, 50, 100')
const strategyOptions = [
  { label: '滚动发布', value: 'rolling' },
  { label: '灰度发布', value: 'canary' },
  { label: '蓝绿发布', value: 'bluegreen' },
]
const canarySteps = computed(() =>
  canaryStepsInput.value
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0 && item <= 100),
)

/* 导入外部镜像（P1 / AR-02）：固定 digest，不重新构建 */
const importVisible = ref(false)
const importRef = ref('')
const importDigest = ref('')
const importing = ref(false)

const reviewVisible = ref(false)
const preview = ref<DeploymentPreview | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewErrorCode = ref('')
const confirming = ref(false)
const confirmError = ref('')
const confirmErrorCode = ref('')

const bindingOptions = computed(() =>
  props.bindings.map((item) => {
    const environment = props.environments.find((env) => env.id === item.environmentId)
    return {
      label: `${environment?.name ?? item.environmentId} · ${item.target.namespace} / ${item.target.releaseName}`,
      value: item.id,
    }
  }),
)

const targetBinding = computed(() => props.bindings.find((item) => item.id === targetBindingId.value) ?? null)
const targetEnvName = computed(() => {
  const binding = targetBinding.value
  if (!binding) return '目标环境'
  return props.environments.find((env) => env.id === binding.environmentId)?.name ?? binding.environmentId
})

const selectedArtifact = computed(
  () => props.artifacts.find((item) => item.id === selectedArtifactId.value) ?? null,
)

const latestArtifactId = computed(() => {
  const newest = props.artifacts
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return newest[0]?.id ?? ''
})

const activeArtifactId = computed(() => {
  const binding = targetBinding.value
  if (!binding) return ''
  const current = props.deployments.find((item) => item.id === binding.currentDeploymentId)
  if (current) return current.artifactId
  const latest = props.deployments
    .filter((item) => item.bindingId === binding.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return latest[0]?.artifactId ?? ''
})

const visibleArtifacts = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return props.artifacts
  return props.artifacts.filter(
    (item) =>
      item.imageRef.toLowerCase().includes(keyword) ||
      item.imageRepository.toLowerCase().includes(keyword) ||
      item.digest.toLowerCase().includes(keyword),
  )
})

const canReview = computed(
  () => Boolean(selectedArtifact.value) && Boolean(targetBinding.value) && !previewLoading.value,
)

const reviewHint = computed(() => {
  if (!targetBinding.value) return '请选择目标环境'
  if (!props.artifacts.length) return '还没有可用镜像'
  if (!selectedArtifact.value) return '请选择一个镜像'
  if (previewLoading.value) return '正在生成预览…'
  return `预览会固定镜像 digest 与配置版本 v${props.configVersion}`
})

function errorCodeOf(err: unknown): string {
  return err instanceof MockError ? err.code : ''
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function onBindingChange(value: SelectValue): void {
  const next = typeof value === 'string' ? value : ''
  if (!next || next === targetBindingId.value) return
  targetBindingId.value = next
  if (reviewVisible.value) reviewVisible.value = false
}

function openImport(): void {
  importRef.value = ''
  importDigest.value = ''
  importVisible.value = true
}

async function confirmImport(): Promise<void> {
  const imageRef = importRef.value.trim()
  const digest = importDigest.value.trim()
  if (!imageRef.includes(':')) {
    MessagePlugin.warning('镜像地址需包含 tag，例如 harbor.acme.dev/acme/app:v1.0.0')
    return
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    MessagePlugin.warning('digest 需为 sha256: 加 64 位小写十六进制')
    return
  }
  importing.value = true
  try {
    const artifact = await importArtifact(props.appId, { imageRef, digest })
    emit('refresh')
    selectedArtifactId.value = artifact.id
    importVisible.value = false
    MessagePlugin.success('镜像已导入并固定 digest')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '导入镜像失败')
  } finally {
    importing.value = false
  }
}

function close(): void {
  reviewVisible.value = false
  emit('update:visible', false)
}

async function loadPreview(): Promise<void> {
  if (!selectedArtifact.value || !targetBinding.value) return
  previewLoading.value = true
  preview.value = null
  previewError.value = ''
  previewErrorCode.value = ''
  confirmError.value = ''
  confirmErrorCode.value = ''
  try {
    preview.value = await previewDeployment(props.appId, {
      bindingId: targetBindingId.value,
      artifactId: selectedArtifactId.value,
      expectedConfigVersion: props.configVersion,
    })
  } catch (err) {
    previewErrorCode.value = errorCodeOf(err)
    if (previewErrorCode.value === 'revision_conflict') {
      previewError.value = '配置已更新，请重新预览'
      emit('refresh')
    } else if (previewErrorCode.value === 'preview_expired') {
      previewError.value = '预览已过期，请重新预览'
    } else {
      previewError.value = errorTextOf(err, '发布预览失败')
    }
  } finally {
    previewLoading.value = false
  }
}

async function openReview(): Promise<void> {
  if (!canReview.value) return
  reviewVisible.value = true
  await loadPreview()
}

async function confirmDeploy(): Promise<void> {
  const current = preview.value
  if (!current || confirming.value) return
  confirming.value = true
  confirmError.value = ''
  confirmErrorCode.value = ''
  try {
    await confirmDeployment({
      previewId: current.previewId,
      bindingId: targetBindingId.value,
      artifactId: selectedArtifactId.value,
      imageRef: current.imageRef,
      configVersion: current.configVersion,
      strategy: strategy.value,
      canarySteps: strategy.value === 'canary' ? canarySteps.value : undefined,
    })
    MessagePlugin.success('已提交发布，正在观察发布状态')
    reviewVisible.value = false
    close()
    await router.push({ name: 'app-deployments', params: { projectId: props.projectId, appId: props.appId } })
  } catch (err) {
    const code = errorCodeOf(err)
    if (code === 'preview_expired' || code === 'revision_conflict') {
      preview.value = null
      previewErrorCode.value = code
      previewError.value = code === 'preview_expired' ? '预览已过期，请重新预览' : '配置已更新，请重新预览'
      if (code === 'revision_conflict') emit('refresh')
    } else {
      confirmErrorCode.value = code
      confirmError.value = errorTextOf(err, '发布失败')
    }
  } finally {
    confirming.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    search.value = ''
    reviewVisible.value = false
    preview.value = null
    previewError.value = ''
    previewErrorCode.value = ''
    confirmError.value = ''
    confirmErrorCode.value = ''
    const preferred = props.bindings.find((item) => item.id === props.bindingId) ?? props.bindings[0]
    targetBindingId.value = preferred?.id ?? ''
    selectedArtifactId.value = props.artifacts[0]?.id ?? ''
    strategy.value = 'rolling'
    canaryStepsInput.value = '20, 50, 100'
  },
  { immediate: true },
)
</script>

<template>
  <t-drawer
    :visible="visible"
    size="820px"
    placement="right"
    :header="`发布到 ${targetEnvName}`"
    :close-btn="true"
    drawer-class-name="bd-image"
    @close="close"
  >
    <div class="im">
      <div class="im__head">
        <span class="im__title">选择镜像</span>
        <t-input v-model="search" class="im__search" size="small" clearable placeholder="按镜像 tag 搜索">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-button size="small" variant="outline" @click="openImport">
          <template #icon><t-icon name="upload" /></template>
          导入外部镜像
        </t-button>
      </div>

      <div class="im__target">
        <span class="im__target-label">目标环境</span>
        <t-select
          class="im__target-select"
          size="small"
          :value="targetBindingId"
          :options="bindingOptions"
          placeholder="选择环境"
          :disabled="!bindings.length"
          @change="onBindingChange"
        />
        <span v-if="targetBinding" class="im__target-target u-mono">
          {{ targetBinding.target.clusterId }} / {{ targetBinding.target.namespace }}
        </span>
      </div>

      <div class="im__list">
        <EmptyState
          v-if="!bindings.length"
          title="尚未绑定环境"
          description="先在配置里绑定环境，才能选择镜像发布。"
        >
          <template #action>
            <router-link :to="{ name: 'config-workflow', params: { projectId, appId } }">去创建工作流</router-link>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="!artifacts.length"
          title="还没有可用镜像"
          description="完成一次构建后，产物会出现在这里。"
          compact
        />

        <EmptyState v-else-if="!visibleArtifacts.length" title="没有匹配的镜像" compact />

        <ul v-else class="im__cards">
          <li v-for="artifact in visibleArtifacts" :key="artifact.id">
            <button
              type="button"
              class="img-card"
              :class="{ 'img-card--active': artifact.id === selectedArtifactId }"
              @click="selectedArtifactId = artifact.id"
            >
              <span class="img-card__main">
                <span class="img-card__tags">
                  <span v-if="artifact.id === activeArtifactId" class="img-card__tag img-card__tag--active">
                    <t-icon name="check-circle" size="12px" />
                    Active on {{ targetEnvName }}
                  </span>
                  <span v-if="artifact.id === latestArtifactId" class="img-card__tag">Latest</span>
                </span>
                <span class="img-card__ref u-mono">{{ artifact.imageRef }}</span>
                <span class="img-card__meta">
                  <t-icon name="layers" size="12px" />
                  {{ shortDigest(artifact.digest) }}
                  <span class="img-card__sep">|</span>
                  {{ artifact.source === 'build' ? '构建产物' : '外部镜像' }}
                  <span class="img-card__sep">|</span>
                  <t-icon name="time" size="12px" />
                  {{ fmtTime(artifact.createdAt) }}
                </span>
              </span>
              <span class="img-card__pick">
                <t-icon v-if="artifact.id === selectedArtifactId" name="check" size="12px" />
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div class="im__foot">
        <span class="im__saved">已保存配置 <b>v{{ configVersion }}</b></span>
        <span class="im__hint">{{ reviewHint }}</span>
        <span class="im__push" />
        <t-button theme="primary" :disabled="!canReview" :loading="previewLoading" @click="openReview">
          Review
        </t-button>
      </div>
    </template>
  </t-drawer>

  <t-dialog
    v-model:visible="importVisible"
    header="导入外部镜像"
    width="560px"
    :confirm-btn="importing ? '导入中…' : '导入'"
    @confirm="confirmImport"
  >
    <div class="imp">
      <p class="u-muted">用于把外部构建或历史镜像纳入发布，导入后固定 digest，不触发重新构建。</p>
      <label class="imp__field">
        <span class="imp__label">镜像地址</span>
        <t-input v-model="importRef" placeholder="harbor.acme.dev/acme/checkout-api:v1.42.0" />
      </label>
      <label class="imp__field">
        <span class="imp__label">digest</span>
        <t-input v-model="importDigest" placeholder="sha256:064a5f…（64 位小写十六进制）" />
      </label>
      <p class="imp__hint">导入会写入应用产物列表，发布时仍走同一套 Review / 确认流程。</p>
    </div>
  </t-dialog>

  <t-dialog v-model:visible="reviewVisible" header="Review" width="760px" :close-on-overlay-click="false">
    <div class="rv">
      <div v-if="previewLoading" class="rv__state">
        <t-loading size="small" />
        <span class="u-muted">正在生成发布预览…</span>
      </div>

      <div v-else-if="!preview" class="rv__state rv__state--error">
        <t-icon name="error-circle" size="20px" class="rv__error-icon" />
        <p class="rv__error-title">{{ previewError || '发布预览不可用' }}</p>
        <p v-if="previewErrorCode" class="u-mono u-dim">{{ previewErrorCode }}</p>
        <p class="rv__error-hint">预览会随镜像与配置版本变化失效，请重新预览后再确认发布。</p>
        <t-button size="small" variant="outline" @click="loadPreview">重新预览</t-button>
      </div>

      <template v-else>
        <t-alert v-if="confirmError" theme="warning" class="rv__alert">
          <span>{{ confirmError }}</span>
          <span v-if="confirmErrorCode" class="u-mono u-dim">（{{ confirmErrorCode }}）</span>
        </t-alert>

        <dl class="tk-kv">
          <dt>目标环境</dt>
          <dd>{{ targetEnvName }}</dd>
          <dt>集群</dt>
          <dd class="u-mono">{{ preview.target.clusterId }}</dd>
          <dt>Namespace</dt>
          <dd class="u-mono">{{ preview.target.namespace }}</dd>
          <dt>releaseName</dt>
          <dd class="u-mono">{{ preview.target.releaseName }}</dd>
          <dt>镜像</dt>
          <dd class="u-mono">{{ preview.imageRef }}</dd>
          <dt>镜像 digest</dt>
          <dd class="u-mono">{{ shortDigest(selectedArtifact?.digest) }}</dd>
          <dt>配置版本</dt>
          <dd>v{{ preview.configVersion }}</dd>
          <dt>预览有效期</dt>
          <dd>{{ fmtTime(preview.expiresAt) }}</dd>
        </dl>

        <template v-if="preview.warnings.length">
          <p class="rv__label">warnings</p>
          <ul class="rv__warnings">
            <li v-for="warning in preview.warnings" :key="warning">
              <t-icon name="info-circle" size="12px" />
              <span>{{ warning }}</span>
            </li>
          </ul>
        </template>

        <div class="rv__strategy">
          <p class="rv__label">发布策略</p>
          <t-radio-group v-model="strategy" :options="strategyOptions" />
          <div v-if="strategy === 'canary'" class="rv__canary">
            <span class="u-dim">放量比例</span>
            <t-input v-model="canaryStepsInput" size="small" class="rv__canary-input" placeholder="20, 50, 100" />
            <span class="u-dim">百分比，逗号分隔；最后一档完成即全量（{{ canarySteps.join(' → ') || '未填写' }}）</span>
          </div>
          <p v-else-if="strategy === 'bluegreen'" class="u-dim">
            蓝绿：先创建新版本（green）并验证，再一次性切流；回滚即切回蓝版本。
          </p>
          <t-alert
            v-else
            theme="info"
            message="滚动发布：按 maxSurge/maxUnavailable 逐步替换 Pod。"
            class="rv__strategy-hint"
          />
        </div>

        <p class="rv__label">变更对比</p>
        <div class="rv__diff">
          <div class="rv__col">
            <p class="rv__col-title">变更前</p>
            <pre class="tk-code rv__code">{{ preview.diff.before }}</pre>
          </div>
          <div class="rv__col">
            <p class="rv__col-title">变更后</p>
            <pre class="tk-code rv__code">{{ preview.diff.after }}</pre>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="rv__foot">
        <t-button variant="outline" @click="reviewVisible = false">取消</t-button>
        <t-button theme="primary" :disabled="!preview || confirming" :loading="confirming" @click="confirmDeploy">
          确认发布
        </t-button>
      </div>
    </template>
  </t-dialog>
</template>

<style scoped>
:global(.bd-image .t-drawer__body) {
  padding: 0;
  overflow: hidden;
}

.im {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.im__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.im__title {
  font-weight: 600;
}
.im__search {
  width: 260px;
  margin-left: auto;
}
.im__target {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.im__target-label {
  color: var(--tk-text-2);
  font-weight: 600;
}
.im__target-select {
  width: 320px;
}
.im__target-target {
  color: var(--tk-text-3);
}
.im__list {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 20px;
  overflow: auto;
  background: #f7f9fc;
}
.im__cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ---- 镜像卡片 ---- */
.img-card {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  font: inherit;
  color: var(--tk-text);
  text-align: left;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.img-card:hover {
  border-color: var(--tk-border-strong);
}
.img-card--active {
  background: #f5f9ff;
  border-color: var(--tk-primary);
}
.img-card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.img-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 18px;
}
.img-card__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  color: var(--tk-text-2);
  font-size: 11px;
  background: #f2f4f8;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.img-card__tag--active {
  color: #1f8f5f;
  background: #e8f8f0;
  border-color: #c4ecd9;
}
.img-card__ref {
  font-size: 12px;
  font-weight: 600;
  word-break: break-all;
}
.img-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.img-card__sep {
  color: var(--tk-border-strong);
}
.img-card__pick {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  color: #fff;
  border: 1px solid var(--tk-border-strong);
  border-radius: 50%;
}
.img-card--active .img-card__pick {
  background: var(--tk-primary);
  border-color: var(--tk-primary);
}

/* ---- 底部 ---- */
.imp {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.imp__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.imp__label {
  color: var(--tk-text-2);
  font-size: 12px;
}
.imp__hint {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.im__foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.im__saved {
  color: var(--tk-text-2);
}
.im__saved b {
  color: var(--tk-text);
}
.im__hint {
  color: var(--tk-text-3);
  font-size: 12px;
}
.im__push {
  flex: 1;
}

/* ---- Review ---- */
.rv {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rv__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;
}
.rv__state--error {
  padding: 28px 16px;
}
.rv__error-icon {
  color: var(--tk-danger);
}
.rv__error-title {
  margin: 0;
  font-weight: 600;
}
.rv__error-hint {
  margin: 0 0 4px;
  max-width: 420px;
  color: var(--tk-text-3);
  font-size: 12px;
}
.rv__alert {
  align-items: center;
}
.rv__label {
  margin: 4px 0 0;
  color: var(--tk-text-2);
  font-weight: 600;
}
.rv__warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--tk-warning);
}
.rv__warnings li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.rv__strategy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 4px;
}
.rv__canary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rv__canary-input {
  width: 180px;
}
.rv__strategy-hint {
  margin-top: 2px;
}
.rv__diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rv__col {
  min-width: 0;
}
.rv__col-title {
  margin: 0 0 4px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.rv__code {
  max-height: 180px;
}
.rv__foot {  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>
