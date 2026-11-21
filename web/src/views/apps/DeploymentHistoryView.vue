<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { SelectValue } from 'tdesign-vue-next'
import { useRoute } from 'vue-router'

import {
  getDeploymentMetrics,
  listArtifacts,
  listBindings,
  listDeployments,
  listEnvironments,
  MockError,
  advanceCanary,
  promoteDeployment,
  reconcileDeployment,
  rollbackDeployment,
} from '@/api'
import type { MetricPoint } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import Sparkline from '@/components/Sparkline.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Artifact, Binding, DeployStrategy, Deployment, Environment } from '@/types'
import { fmtRelative, fmtTime, shortDigest } from '@/utils/format'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))

const kindMap: Record<Deployment['kind'], string> = {
  deploy: '发布',
  promote: '晋级',
  rollback: '回滚',
}

const strategyMap: Record<DeployStrategy, string> = {
  rolling: '滚动发布',
  canary: '灰度发布',
  bluegreen: '蓝绿发布',
}

const statusMap: Record<Deployment['status'], string> = {
  queued: '排队中',
  submitting: '提交中',
  observing: '观察中',
  succeeded: '成功',
  failed: '失败',
  unknown: '结果未知',
}

const deployments = ref<Deployment[]>([])
const listLoading = ref(true)
const listError = ref('')
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const artifacts = ref<Artifact[]>([])
const envFilter = ref('all')
const selectedId = ref('')

const acting = ref(false)
const reconciling = ref(false)
const advancing = ref(false)
const promoteTargetId = ref('')
const rollbackReason = ref('')
const actionError = ref('')
const actionErrorCode = ref('')

const envOptions = computed(() => [
  { label: '全部环境', value: 'all' },
  ...environments.value.map((item) => ({ label: item.name, value: item.id })),
])

function bindingById(id: string): Binding | null {
  return bindings.value.find((item) => item.id === id) ?? null
}

function envNameOf(binding: Binding | null): string {
  if (!binding) return '未绑定环境'
  return environments.value.find((item) => item.id === binding.environmentId)?.name ?? binding.environmentId
}

const visibleDeployments = computed(() => {
  if (envFilter.value === 'all') return deployments.value
  return deployments.value.filter((item) => bindingById(item.bindingId)?.environmentId === envFilter.value)
})

const detail = computed<Deployment | null>(
  () => deployments.value.find((item) => item.id === selectedId.value) ?? null,
)

const detailBinding = computed<Binding | null>(() => {
  const current = detail.value
  if (!current) return null
  return bindingById(current.bindingId)
})

const detailArtifact = computed<Artifact | null>(() => {
  const current = detail.value
  if (!current) return null
  return artifacts.value.find((item) => item.id === current.artifactId) ?? null
})

/* P2：发布指标趋势（mock 序列） */
const metrics = ref<MetricPoint[]>([])
const metricsLoading = ref(false)

async function loadMetrics(): Promise<void> {
  const current = detail.value
  if (!current) {
    metrics.value = []
    return
  }
  metricsLoading.value = true
  try {
    metrics.value = await getDeploymentMetrics(current.id)
  } catch {
    metrics.value = []
  } finally {
    metricsLoading.value = false
  }
}

watch(detail, () => void loadMetrics(), { immediate: true })

const promoteOptions = computed(() =>
  bindings.value
    .filter((item) => item.id !== detail.value?.bindingId)
    .map((item) => ({
      label: `${envNameOf(item)} · ${item.target.namespace} / ${item.target.releaseName}`,
      value: item.id,
    })),
)

const statusText = computed(() => statusMap[detail.value?.status ?? 'queued'])

const canRollback = computed(() => rollbackReason.value.trim().length > 0 && !acting.value)

function errorCodeOf(err: unknown): string {
  return err instanceof MockError ? err.code : ''
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function loadDeployments(): Promise<void> {
  listLoading.value = true
  listError.value = ''
  try {
    const result = await listDeployments(appId.value)
    deployments.value = result.items
    if (selectedId.value && !deployments.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = ''
    }
    // 首次进入自动选中最新一条，避免右侧空白
    if (!selectedId.value && deployments.value.length) {
      selectedId.value = deployments.value[0].id
    }
  } catch (err) {
    listError.value = errorTextOf(err, '发布记录加载失败')
  } finally {
    listLoading.value = false
  }
}

async function loadMeta(): Promise<void> {
  try {
    const [bindingList, environmentList, artifactList] = await Promise.all([
      listBindings(appId.value),
      listEnvironments(),
      listArtifacts(appId.value),
    ])
    bindings.value = bindingList
    environments.value = environmentList
    artifacts.value = artifactList
  } catch {
    bindings.value = []
    environments.value = []
    artifacts.value = []
  }
}

async function refresh(): Promise<void> {
  await Promise.all([loadDeployments(), loadMeta()])
}

function onFilterChange(value: SelectValue): void {
  const next = typeof value === 'string' ? value : 'all'
  envFilter.value = next
}

function onPromoteTargetChange(value: SelectValue): void {
  promoteTargetId.value = typeof value === 'string' ? value : ''
}

async function onPromote(): Promise<void> {
  const current = detail.value
  const target = promoteTargetId.value
  if (!current || !target || acting.value) return
  acting.value = true
  actionError.value = ''
  actionErrorCode.value = ''
  try {
    const created = await promoteDeployment(current.id, target)
    MessagePlugin.success('已提交晋级发布')
    promoteTargetId.value = ''
    await loadDeployments()
    selectedId.value = created.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '晋级失败')
  } finally {
    acting.value = false
  }
}

async function onAdvanceCanary(): Promise<void> {
  const current = detail.value
  if (!current || advancing.value) return
  advancing.value = true
  actionError.value = ''
  actionErrorCode.value = ''
  try {
    const updated = await advanceCanary(current.id)
    MessagePlugin.success(
      updated.status === 'succeeded'
        ? '灰度已完成，已全量'
        : `已推进到 ${updated.canary?.steps[updated.canary.currentStep] ?? 0}%`,
    )
    await loadDeployments()
    selectedId.value = updated.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '推进灰度失败')
  } finally {
    advancing.value = false
  }
}

async function onReconcile(): Promise<void> {
  const current = detail.value
  if (!current || reconciling.value) return
  reconciling.value = true
  actionError.value = ''
  actionErrorCode.value = ''
  try {
    const updated = await reconcileDeployment(current.id)
    MessagePlugin.success(`核对完成：${updated.status === 'succeeded' ? 'release 已就绪' : '仍未就绪'}`)
    await loadDeployments()
    selectedId.value = updated.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '核对失败')
  } finally {
    reconciling.value = false
  }
}

async function onRollback(): Promise<void> {
  const current = detail.value
  if (!current || !canRollback.value) return
  acting.value = true
  actionError.value = ''
  actionErrorCode.value = ''
  try {
    const created = await rollbackDeployment(current.id, rollbackReason.value.trim())
    MessagePlugin.success('已提交回滚发布')
    rollbackReason.value = ''
    await loadDeployments()
    selectedId.value = created.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '回滚失败')
  } finally {
    acting.value = false
  }
}

watch(
  appId,
  () => {
    selectedId.value = ''
    promoteTargetId.value = ''
    rollbackReason.value = ''
    void refresh()
  },
  { immediate: true },
)
</script>

<template>
  <div class="deploy">
    <section class="tk-panel deploy__list">
      <div class="tk-panel__head">
        <span>
          发布记录
          <span class="u-dim">（{{ visibleDeployments.length }}）</span>
        </span>
        <t-button size="small" variant="text" :loading="listLoading" @click="refresh">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
      </div>
      <div class="deploy__filter">
        <t-select :value="envFilter" :options="envOptions" size="small" @change="onFilterChange" />
      </div>
      <div class="deploy__scroll">
        <div v-if="listLoading && !deployments.length" class="deploy__state">
          <t-loading size="small" />
          <span class="u-muted">加载发布记录…</span>
        </div>
        <ErrorState v-else-if="listError" :message="listError" @retry="refresh" />
        <EmptyState
          v-else-if="!visibleDeployments.length"
          title="当前筛选下没有发布记录"
          description="在构建发布页选择镜像并确认发布后，这里会出现记录。"
          compact
        />
        <ul v-else class="deploy-list">
          <li v-for="item in visibleDeployments" :key="item.id">
            <button
              type="button"
              class="deploy-item"
              :class="{ 'deploy-item--active': item.id === selectedId }"
              @click="selectedId = item.id"
            >
              <span class="deploy-item__top">
                <span class="deploy-item__env">{{ envNameOf(bindingById(item.bindingId)) }}</span>
                <t-tag variant="outline" size="small">{{ kindMap[item.kind] }}</t-tag>
                <StatusTag class="deploy-item__status" kind="deploy" :value="item.status" />
              </span>
              <span class="deploy-item__meta u-dim">{{ fmtRelative(item.createdAt) }} · {{ item.operator }}</span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section class="tk-panel deploy__detail">
      <div v-if="!selectedId" class="deploy__state deploy__state--tall">
        <EmptyState title="选择左侧发布记录查看详情" description="详情包含目标环境、镜像 digest 与晋级/回滚操作。" />
      </div>
      <template v-else-if="detail">
        <div class="deploy-head">
          <div class="deploy-head__main">
            <p class="deploy-head__image u-mono">{{ detail.imageRef }}</p>
            <div class="u-flex u-gap-8">
              <StatusTag kind="deploy" :value="detail.status" />
              <t-tag variant="outline" size="small">{{ kindMap[detail.kind] }}</t-tag>
              <span class="u-dim">操作人 {{ detail.operator }}</span>
              <span class="u-dim">· {{ fmtTime(detail.createdAt) }}</span>
            </div>
          </div>
        </div>

        <div v-if="detail.status === 'failed' || detail.status === 'unknown'" class="deploy__block">
          <t-alert v-if="detail.status === 'failed'" theme="error" :message="detail.reason || '发布失败，未记录原因'" />
          <t-alert v-else theme="warning">
            <div class="deploy-alert">
              <span>结果未知，需核对实际 release 状态</span>
              <span v-if="detail.reason" class="u-dim">{{ detail.reason }}</span>
              <div class="deploy-alert__row">
                <t-button size="small" theme="primary" variant="outline" :loading="reconciling" @click="onReconcile">
                  <template #icon><t-icon name="refresh" /></template>
                  核对结果
                </t-button>
                <span class="u-dim">不允许自动重试；核对会读回 Helm release 的实际状态。</span>
              </div>
            </div>
          </t-alert>
        </div>

        <div class="deploy__block">
          <div class="deploy-metrics__head">
            <span class="deploy__label">近 6 小时指标</span>
            <t-button size="small" variant="text" :loading="metricsLoading" @click="loadMetrics">刷新</t-button>
          </div>
          <div class="deploy-metrics">
            <div class="deploy-metric">
              <span class="deploy-metric__label">CPU 使用率</span>
              <Sparkline :values="metrics.map((point) => point.cpu)" unit="%" />
            </div>
            <div class="deploy-metric">
              <span class="deploy-metric__label">内存（MiB）</span>
              <Sparkline :values="metrics.map((point) => point.memory)" unit="" tone="success" />
            </div>
            <div class="deploy-metric">
              <span class="deploy-metric__label">副本数</span>
              <Sparkline :values="metrics.map((point) => point.replicas)" unit="" tone="warning" />
            </div>
          </div>
          <p class="u-dim deploy-metrics__hint">
            指标为 mock 序列（{{ metrics.length }} 个采样点）；接入后来源为 metrics-server / Prometheus。
          </p>
        </div>

        <div class="deploy__block">
          <dl class="tk-kv">
            <dt>环境绑定</dt>
            <dd>
              <template v-if="detailBinding">
                {{ envNameOf(detailBinding) }} · {{ detailBinding.target.namespace }} /
                {{ detailBinding.target.releaseName }}
              </template>
              <template v-else>—</template>
            </dd>
            <dt>集群 / 命名空间</dt>
            <dd class="u-mono">{{ detailBinding ? `${detailBinding.target.clusterId} / ${detailBinding.target.namespace}` : '—' }}</dd>
            <dt>releaseName</dt>
            <dd class="u-mono">{{ detailBinding?.target.releaseName ?? '—' }}</dd>
            <dt>镜像 digest</dt>
            <dd class="u-mono">{{ detailArtifact ? shortDigest(detailArtifact.digest) : '—' }}</dd>
            <dt>配置版本</dt>
            <dd>v{{ detail.configVersion }}</dd>
            <dt>Helm revision</dt>
            <dd>{{ detail.helmRevision ?? '—' }}</dd>
            <dt>类型</dt>
            <dd>{{ kindMap[detail.kind] }}</dd>
            <dt>发布策略</dt>
            <dd>{{ strategyMap[detail.strategy ?? 'rolling'] }}</dd>
          </dl>

          <div v-if="detail.canary" class="deploy-canary">
            <div class="deploy-canary__head">
              <span class="deploy-canary__title">灰度进度</span>
              <span class="u-dim">
                第 {{ detail.canary.currentStep + 1 }} / {{ detail.canary.steps.length }} 档 · 当前
                {{ detail.canary.steps[detail.canary.currentStep] }}%
              </span>
            </div>
            <div class="deploy-canary__steps">
              <span
                v-for="(step, index) in detail.canary.steps"
                :key="step"
                class="deploy-canary__step"
                :class="{
                  'deploy-canary__step--done': index <= detail.canary.currentStep,
                  'deploy-canary__step--current': index === detail.canary.currentStep,
                }"
              >
                {{ step }}%
              </span>
            </div>
            <div class="deploy-canary__actions">
              <t-button
                v-if="detail.status === 'observing' && detail.canary.currentStep < detail.canary.steps.length - 1"
                size="small"
                theme="primary"
                variant="outline"
                :loading="advancing"
                @click="onAdvanceCanary"
              >
                推进到 {{ detail.canary.steps[detail.canary.currentStep + 1] }}%
              </t-button>
              <span v-else-if="detail.status !== 'observing'" class="u-dim">灰度已结束（{{ statusText }}）。</span>
              <span v-else class="u-dim">已到最后一档，等待观察窗口结束。</span>
            </div>
          </div>

          <p v-else-if="detail.strategy === 'bluegreen'" class="deploy-canary__note">
            蓝绿：green 版本验证通过后一次性切流；回滚即切回 blue 版本。
          </p>
        </div>

        <div class="deploy__block deploy-actions">
          <div v-if="promoteOptions.length" class="deploy-actions__row">
            <div class="deploy-actions__info">
              <p class="deploy-actions__title">晋级到其他环境</p>
              <p class="u-dim">复用当前镜像与配置版本，在目标环境新建 release。</p>
            </div>
            <div class="deploy-actions__form">
              <t-select
                class="deploy-actions__select"
                :value="promoteTargetId"
                :options="promoteOptions"
                placeholder="选择目标环境"
                size="small"
                @change="onPromoteTargetChange"
              />
              <t-button
                theme="primary"
                variant="outline"
                size="small"
                :disabled="!promoteTargetId || acting"
                :loading="acting"
                @click="onPromote"
              >
                <template #icon><t-icon name="arrow-right" /></template>
                确认晋级
              </t-button>
            </div>
          </div>
          <p v-else class="u-muted">当前应用没有其他可晋级的目标环境。</p>

          <div class="deploy-actions__row">
            <div class="deploy-actions__info">
              <p class="deploy-actions__title">回滚到此版本</p>
              <p class="u-dim">填写回滚原因，将在同一环境重新发布该镜像。</p>
            </div>
            <div class="deploy-actions__form">
              <t-input v-model="rollbackReason" class="deploy-actions__input" placeholder="回滚原因（必填）" size="small" />
              <t-button
                theme="danger"
                variant="outline"
                size="small"
                :disabled="!canRollback"
                :loading="acting"
                @click="onRollback"
              >
                <template #icon><t-icon name="rollback" /></template>
                确认回滚
              </t-button>
            </div>
          </div>

          <p v-if="actionError" class="deploy-actions__error">
            {{ actionError }}
            <span v-if="actionErrorCode" class="u-mono u-dim">（{{ actionErrorCode }}）</span>
          </p>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.deploy {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 12px;
  align-items: start;
}
.deploy__list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.deploy__filter {
  padding: 8px 10px;
  border-bottom: 1px solid var(--tk-border);
}
.deploy__scroll {
  max-height: 640px;
  overflow: auto;
}
.deploy__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 12px;
}
.deploy__state--tall {
  min-height: 260px;
}
.deploy__detail {
  min-width: 0;
  min-height: 320px;
}
.deploy-list {
  display: flex;
  flex-direction: column;
}
.deploy-list > li + li {
  border-top: 1px solid var(--tk-border);
}
.deploy-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  color: var(--tk-text);
  text-align: left;
  background: none;
  border: 0;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.deploy-item:hover {
  background: var(--tk-bg);
}
.deploy-item--active {
  background: var(--tk-primary-weak);
  border-left-color: var(--tk-primary);
}
.deploy-item__top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.deploy-item__env {
  font-weight: 600;
}
.deploy-item__status {
  margin-left: auto;
}
.deploy-item__meta {
  font-size: 11px;
}
.deploy-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--tk-border);
}
.deploy-head__main {
  min-width: 0;
}
.deploy-head__image {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
}
.deploy__block {
  padding: 12px;
}
.deploy__block + .deploy__block {
  border-top: 1px solid var(--tk-border);
}
.deploy-metrics__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.deploy-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.deploy-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.deploy-metric__label {
  color: var(--tk-text-2);
  font-size: 12px;
}
.deploy-metrics__hint {
  margin: 8px 0 0;
  font-size: 11px;
}
.deploy-alert {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.deploy-alert__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.deploy-canary {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f7f9fc;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.deploy-canary__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.deploy-canary__title {
  font-weight: 600;
}
.deploy-canary__steps {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.deploy-canary__step {
  padding: 2px 8px;
  color: var(--tk-text-2);
  font-size: 12px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: 10px;
}
.deploy-canary__step--done {
  color: var(--tk-primary);
  border-color: #b9d0f5;
  background: #eef4fd;
}
.deploy-canary__step--current {
  color: #fff;
  background: var(--tk-primary);
  border-color: var(--tk-primary);
}
.deploy-canary__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.deploy-canary__note {
  margin: 10px 0 0;
  color: var(--tk-text-2);
}
.deploy-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.deploy-actions__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.deploy-actions__info {
  min-width: 0;
}
.deploy-actions__title {
  margin: 0;
  font-weight: 600;
}
.deploy-actions__info p {
  margin: 2px 0 0;
}
.deploy-actions__form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.deploy-actions__select {
  width: 260px;
}
.deploy-actions__input {
  width: 240px;
}
.deploy-actions__error {
  margin: 0;
  color: var(--tk-danger);
}
</style>
