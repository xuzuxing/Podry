<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
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
const expandedId = ref('')

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
  const newest = props.artifacts.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
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

/** 镜像 tag（Devtron 卡片只展示 tag，如 522bcd2f-4-6） */
function tagOf(artifact: Artifact): string {
  const parts = artifact.imageRef.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : artifact.imageRef
}

/** 该镜像在当前环境的部署时间；没有部署过返回空串 */
function deployedAt(artifact: Artifact): string {
  const binding = targetBinding.value
  if (!binding) return ''
  const record = props.deployments
    .filter(
      (item) =>
        item.bindingId === binding.id &&
        item.artifactId === artifact.id &&
        (item.status === 'succeeded' || item.status === 'observing'),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  return record?.createdAt ?? ''
}

function errorCodeOf(err: unknown): string {
  return err instanceof MockError ? err.code : ''
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
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
    expandedId.value = ''
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
    size="1024px"
    placement="right"
    :header="`部署到 ${targetEnvName}`"
    :close-btn="true"
    drawer-class-name="bd-image"
    @close="close"
  >
    <div class="im">
      <div class="im__head">
        <span class="im__title">选择镜像</span>
        <span class="im__import" title="导入外部镜像" @click="openImport">
          <t-icon name="upload" size="16px" />
        </span>
        <span class="im__refresh" title="刷新镜像列表" @click="emit('refresh')">
          <t-icon name="refresh" size="16px" />
        </span>
        <t-input v-model="search" class="im__search" size="small" clearable placeholder="按镜像 tag 搜索">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
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
            <div
              class="img-card"
              :class="{ 'img-card--active': artifact.id === selectedArtifactId }"
              role="button"
              tabindex="0"
              @click="selectedArtifactId = artifact.id"
              @keydown.enter="selectedArtifactId = artifact.id"
            >
              <div class="img-card__top">
                <span class="img-card__chips">
                  <span v-if="artifact.id === activeArtifactId" class="chip chip--active">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6.4" stroke="#1DAD70" stroke-width="1.4" />
                      <path d="m5.6 8.1 1.7 1.7 3.2-3.6" stroke="#1DAD70" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    当前环境使用                  </span>
                  <span v-if="artifact.id === latestArtifactId" class="chip">最新</span>
                </span>
                <span class="img-card__pick">
                  <t-icon v-if="artifact.id === selectedArtifactId" name="check" size="12px" />
                </span>
              </div>

              <div class="img-card__ref">
                <t-icon name="layers" size="14px" />
                <span class="img-card__tag">{{ tagOf(artifact) }}</span>
              </div>

              <div class="img-card__when">
                <template v-if="deployedAt(artifact)">
                  <t-icon name="calendar" size="13px" />
                  {{ fmtTime(deployedAt(artifact)) }}
                </template>
                <template v-else>
                  <t-icon name="time" size="13px" />
                  未部署
                </template>
              </div>

              <div class="img-card__labels">+ 添加标签/备注</div>

              <button
                type="button"
                class="img-card__more"
                @click.stop="expandedId = expandedId === artifact.id ? '' : artifact.id"
              >
                展开详情
                <t-icon :name="expandedId === artifact.id ? 'chevron-up' : 'chevron-down'" size="14px" />
              </button>

              <dl v-if="expandedId === artifact.id" class="img-card__info">
                <dt>镜像仓库</dt>
                <dd class="u-mono">{{ artifact.imageRepository }}</dd>
                <dt>摘要</dt>
                <dd class="u-mono">{{ shortDigest(artifact.digest) }}</dd>
                <dt>来源</dt>
                <dd>{{ artifact.source === 'build' ? `构建产物 ${artifact.buildId ?? ''}` : '外部镜像' }}</dd>
                <dt>创建时间</dt>
                <dd>{{ fmtTime(artifact.createdAt) }}</dd>
              </dl>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div class="im__foot">
        <div class="im__tile">
          <span class="im__tile-deploy">
            部署：
            <span class="im__tile-value">最近保存的配置</span>
            <t-icon name="chevron-down" size="14px" />
          </span>
          <button type="button" class="im__diff" @click="openReview">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#F33E3E" />
              <path d="M8 4.6v4.2M8 11.2v.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            <span>配置差异</span>
            <span class="im__review">查看</span>
          </button>
        </div>
        <span class="im__hint">{{ reviewHint }}</span>
        <t-button theme="primary" :disabled="!canReview" :loading="previewLoading" @click="openReview">
          部署
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
      <p class="imp__hint">导入会写入应用产物列表，发布时仍走同一套预览 / 确认流程。</p>
    </div>
  </t-dialog>

  <t-dialog v-model:visible="reviewVisible" header="发布预览" width="760px" :close-on-overlay-click="false">
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
/* Devtron 弹窗：右侧 1024 宽、全高、白底 */
:global(.bd-image) {
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.14);
}
:global(.bd-image .t-drawer__header) {
  min-height: 49px;
  padding: 12px 20px;
  color: #000a14;
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
  border-bottom: 1px solid #e6e9ef;
}
:global(.bd-image .t-drawer__body) {
  padding: 0;
  overflow: hidden;
}
:global(.bd-image .t-drawer__footer) {
  padding: 16px 20px;
  border-top: 1px solid #e6e9ef;
}

.im {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f2f4f7;
}
.im__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 8px;
}
.im__title {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.im__refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  color: #596168;
  cursor: pointer;
}
.im__import {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  color: #596168;
  cursor: pointer;
}
.im__import + .im__refresh {
  margin-left: 0;
}
.im__search {
  width: 260px;
}
.im__list {
  flex: 1;
  min-height: 0;
  padding: 8px 20px 20px;
  overflow: auto;
}
.im__cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- 镜像卡片 ---- */
.img-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  cursor: pointer;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}
.img-card:hover {
  border-color: #b1b7bc;
}
.img-card--active {
  border-color: #0066cc;
}
.img-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.img-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 20px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  color: #3b444c;
  font-size: 11px;
  line-height: 18px;
  background: #edf1f5;
  border-radius: 2px;
}
.chip--active {
  color: #1dad70;
  background: #e8f7f0;
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
  border: 1px solid #b1b7bc;
  border-radius: 50%;
}
.img-card--active .img-card__pick {
  background: #0066cc;
  border-color: #0066cc;
}
.img-card__ref {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #000a14;
  font-size: 12px;
  font-weight: 600;
}
.img-card__tag {
  font-family: var(--tk-mono);
}
.img-card__when {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.img-card__labels {
  align-self: flex-start;
  padding: 3px 10px;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
  border: 1px dashed #b1b7bc;
  border-radius: 4px;
}
.img-card__more {
  position: absolute;
  right: 16px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  color: #596168;
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.img-card__info {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 4px 12px;
  margin: 6px 0 22px;
  padding-top: 8px;
  border-top: 1px solid #edf1f5;
  font-size: 12px;
}
.img-card__info dt {
  color: #767d84;
}
.img-card__info dd {
  margin: 0;
  overflow: hidden;
  color: #3b444c;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 底部 ---- */
.im__foot {
  display: flex;
  align-items: center;
  gap: 12px;
}
.im__tile {
  display: flex;
  align-items: stretch;
  height: 42px;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}
.im__tile-deploy {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 16px;
  color: #3b444c;
  font-size: 12px;
}
.im__tile-value {
  color: #3b444c;
  font-weight: 600;
}
.im__diff {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  color: #3b444c;
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  border-left: 1px solid #d0d4d9;
  cursor: pointer;
}
.im__diff:hover {
  background: #f7fafc;
}
.im__review {
  color: #0066cc;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.im__hint {
  flex: 1;
  overflow: hidden;
  color: #767d84;
  font-size: 12px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 导入 ---- */
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
  max-width: 420px;
  margin: 0 0 4px;
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
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
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
.rv__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
</style>
