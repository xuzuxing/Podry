<script setup lang="ts">
/**
 * 发布历史：对齐真实 Devtron 的 Deployment History 布局。
 * 左列 = Select Environment + 该环境的发布列表；右侧 = 时间线 + Source/Configuration 页签。
 */
import BuildSourceSnapshot from '@/components/application/BuildSourceSnapshot.vue'
import ArtifactSummaryCard from '@/components/application/ArtifactSummaryCard.vue'
import ArtifactDetailsDrawer from '@/components/application/ArtifactDetailsDrawer.vue'
import ArtifactMetadataDialog from '@/components/application/ArtifactMetadataDialog.vue'
import { artifactImageLabel } from '@/utils/artifactDetails'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { SelectValue } from 'tdesign-vue-next'
import { useRoute, useRouter } from 'vue-router'

import {
  advanceCanary,
  getConfig,
  getDeployment,
  listArtifacts,
  listBindings,
  listBuilds,
  listDeployments,
  listEnvironments,
  MockError,
  promoteDeployment,
  reconcileDeployment,
  rollbackDeployment,
} from '@/api'
import type {
  AppConfig,
  Artifact,
  Binding,
  Build,
  DeployStrategy,
  Deployment,
  Environment,
} from '@/types'
import { fmtTime, shortDigest } from '@/utils/format'
import DeploymentSnapshotPanel from '@/components/application/DeploymentSnapshotPanel.vue'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

/* ---------------- 展示映射 ---------------- */
type Tone = 'success' | 'failed' | 'progress' | 'unknown'

const kindMap: Record<Deployment['kind'], string> = { deploy: '部署', promote: '晋级', rollback: '回滚' }

const timelineKindMap: Record<Deployment['kind'], string> = {
  deploy: '部署',
  promote: '晋级',
  rollback: '回滚',
}

const strategyMap: Record<DeployStrategy, string> = {
  rolling: '滚动发布',
  canary: '灰度发布',
  bluegreen: '蓝绿发布',
}

function toneOfStatus(status: Deployment['status']): Tone {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'unknown') return 'unknown'
  return 'progress'
}

function labelOfStatus(status: Deployment['status']): string {
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'queued') return '排队中'
  if (status === 'submitting') return '提交中'
  if (status === 'observing') return '部署中'
  return '待核对'
}

const iconOfTone: Record<Tone, string> = {
  success: 'check-circle-filled',
  failed: 'close-circle-filled',
  progress: 'loading',
  unknown: 'error-circle-filled',
}

/* ---------------- 数据 ---------------- */
const deployments = ref<Deployment[]>([])
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const artifacts = ref<Artifact[]>([])
const builds = ref<Build[]>([])
const config = ref<AppConfig | null>(null)

const loading = ref(true)
const loadError = ref('')
const selectedEnvId = ref('')
const selectedDeploymentId = ref('')
const activeTab = ref<'source' | 'config'>('source')

const envOptions = computed(() => environments.value.map((item) => ({ label: item.name, value: item.id })))

const selectedEnv = computed(() => environments.value.find((item) => item.id === selectedEnvId.value) ?? null)
const envName = computed(() => selectedEnv.value?.name ?? '')

function deploymentsOfEnv(envId: string): Deployment[] {
  if (!envId) return []
  const bindingIds = new Set(bindings.value.filter((item) => item.environmentId === envId).map((item) => item.id))
  return deployments.value.filter((item) => bindingIds.has(item.bindingId))
}

const envDeployments = computed(() => deploymentsOfEnv(selectedEnvId.value))

const detail = computed<Deployment | null>(
  () => envDeployments.value.find((item) => item.id === selectedDeploymentId.value) ?? null,
)

const detailBinding = computed<Binding | null>(() => {
  const current = detail.value
  if (!current) return null
  return bindings.value.find((item) => item.id === current.bindingId) ?? null
})

const detailArtifact = computed<Artifact | null>(() => {
  const current = detail.value
  if (!current) return null
  return artifacts.value.find((item) => item.id === current.artifactId) ?? null
})

const detailBuild = computed<Build | null>(() => {
  const artifact = detailArtifact.value
  if (!artifact?.buildId) return null
  return builds.value.find((item) => item.id === artifact.buildId) ?? null
})


const canary = computed(() => detail.value?.canary ?? null)

const statusInfo = computed<{ label: string; tone: Tone }>(() => {
  const value = detail.value?.status ?? 'unknown'
  return { label: labelOfStatus(value), tone: toneOfStatus(value) }
})

/* ---------------- 时间 / 镜像格式化 ---------------- */
/** 本地化时间：2026-11-21 14:41 */
function fmtWhen(iso: string | null | undefined): string {
  return fmtTime(iso)
}

function imageTagOf(imageRef: string): string {
  return artifactImageLabel(imageRef)
}

function shortTag(imageRef: string): string {
  const tag = imageTagOf(imageRef)
  return tag.length > 14 ? `…${tag.slice(-12)}` : tag
}


/* ---------------- 配置详情 ---------------- */
const historicalTarget = computed(() => detail.value?.configSnapshot?.target)

const configDrift = computed(() => {
  if (!config.value || !detail.value) return false
  return config.value.version !== detail.value.configVersion
})

/* ---------------- 动作 ---------------- */
const acting = ref(false)
const reconciling = ref(false)
const advancing = ref(false)
const promoteOpen = ref(false)
const rollbackOpen = ref(false)
const labelOpen = ref(false)
const imageDetailsVisible = ref(false)
const promoteTargetId = ref('')
const rollbackReason = ref('')
const actionError = ref('')
const actionErrorCode = ref('')

const promoteOptions = computed(() =>
  bindings.value
    .filter((item) => item.id !== detail.value?.bindingId)
    .map((item) => ({
      label: `${environments.value.find((env) => env.id === item.environmentId)?.name ?? item.environmentId} · ${item.target.namespace} / ${item.target.releaseName}`,
      value: item.id,
    })),
)

const canPromote = computed(() => !!detail.value && detail.value.status === 'succeeded' && promoteOptions.value.length > 0)
const canRollback = computed(() => {
  const status = detail.value?.status
  return status === 'succeeded' || status === 'failed' || status === 'observing'
})
const canAdvanceCanary = computed(
  () =>
    !!detail.value &&
    !!canary.value &&
    detail.value.status === 'observing' &&
    canary.value.currentStep < canary.value.steps.length - 1,
)

function errorCodeOf(err: unknown): string {
  return err instanceof MockError ? err.code : ''
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function syncEnvQuery(envId: string): void {
  const query = { ...route.query }
  delete query.deployment
  delete query.tab
  if (envId) query.env = envId
  else delete query.env
  void router.replace({ query })
}

function selectDeployment(id: string): void {
  selectedDeploymentId.value = id
  void router.replace({ query: { ...route.query, deployment: id } })
}

function selectEnv(envId: string): void {
  selectedEnvId.value = envId
  activeTab.value = 'source'
  selectedDeploymentId.value = envId ? deploymentsOfEnv(envId)[0]?.id ?? '' : ''
  syncEnvQuery(envId)
}

function onEnvChange(value: SelectValue): void {
  selectEnv(typeof value === 'string' ? value : '')
}

/* ---------------- 加载 ---------------- */
async function loadDeployments(): Promise<void> {
  const result = await listDeployments(appId.value)
  deployments.value = result.items
}

async function loadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [result, bindingList, environmentList, artifactList] = await Promise.all([
      listDeployments(appId.value),
      listBindings(appId.value),
      listEnvironments(),
      listArtifacts(appId.value),
    ])
    deployments.value = result.items
    bindings.value = bindingList
    environments.value = environmentList
    artifacts.value = artifactList

    // 对比页返回及历史深链可以定位分页之外的记录；不能串用其他应用。
    const requested = typeof route.query.deployment === 'string' ? route.query.deployment : ''
    if (requested && !deployments.value.some(item => item.id === requested)) {
      try {
        const item = await getDeployment(requested)
        if (item.appId === appId.value && bindingList.some(binding => binding.id === item.bindingId)) deployments.value = [...deployments.value, item]
      } catch { /* 缺失记录保留为空，不回退展示另一条记录。 */ }
    }

    const wanted = typeof route.query.env === 'string' ? route.query.env : ''
    if (wanted && environmentList.some((item) => item.id === wanted)) {
      selectedEnvId.value = wanted
    }
    activeTab.value = route.query.tab === 'config' ? 'config' : 'source'
  } catch (err) {
    loadError.value = errorTextOf(err, '发布记录加载失败')
  } finally {
    loading.value = false
  }
  void loadSourceMeta()
}

async function loadSourceMeta(): Promise<void> {
  try {
    const [appConfig, buildPage] = await Promise.all([getConfig(appId.value), listBuilds(appId.value)])
    config.value = appConfig
    builds.value = buildPage.items
  } catch {
    config.value = null
    builds.value = []
  }
}

/* ---------------- 动作实现 ---------------- */
function openPromote(): void {
  actionError.value = ''
  actionErrorCode.value = ''
  promoteTargetId.value = ''
  promoteOpen.value = true
}

function openRollback(): void {
  actionError.value = ''
  actionErrorCode.value = ''
  rollbackReason.value = ''
  rollbackOpen.value = true
}

function openLabel(): void {
  labelOpen.value = true
}

function artifactSaved(saved: Artifact): void {
  artifacts.value = artifacts.value.map(item => item.id === saved.id && saved.appId === appId.value ? saved : item)
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
    promoteOpen.value = false
    await loadDeployments()
    const targetBinding = bindings.value.find((item) => item.id === created.bindingId)
    if (targetBinding) selectedEnvId.value = targetBinding.environmentId
    selectedDeploymentId.value = created.id
    syncEnvQuery(selectedEnvId.value)
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '晋级失败')
  } finally {
    acting.value = false
  }
}

async function onRollback(): Promise<void> {
  const current = detail.value
  const reason = rollbackReason.value.trim()
  if (!current || !reason || acting.value) return
  acting.value = true
  actionError.value = ''
  actionErrorCode.value = ''
  try {
    const created = await rollbackDeployment(current.id, reason)
    MessagePlugin.success('已提交回滚发布')
    rollbackOpen.value = false
    rollbackReason.value = ''
    await loadDeployments()
    selectedDeploymentId.value = created.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '回滚失败')
  } finally {
    acting.value = false
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
    selectedDeploymentId.value = updated.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '核对失败')
  } finally {
    reconciling.value = false
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
    selectedDeploymentId.value = updated.id
  } catch (err) {
    actionErrorCode.value = errorCodeOf(err)
    actionError.value = errorTextOf(err, '推进灰度失败')
  } finally {
    advancing.value = false
  }
}

/* ---------------- 联动 ---------------- */
/** 环境切换 / 数据刷新后，优先定位 URL 记录，没有指定时选择最新一条发布。 */
watch(envDeployments, (list) => {
  if (typeof route.query.deployment === 'string') {
    selectedDeploymentId.value = list.some(item => item.id === route.query.deployment) ? route.query.deployment : ''
    return
  }
  if (!selectedDeploymentId.value || !list.some((item) => item.id === selectedDeploymentId.value)) {
    selectedDeploymentId.value = list[0]?.id ?? ''
  }
})

let queryGeneration = 0
watch(() => [route.query.env, route.query.deployment, route.query.tab], async () => {
  const token = ++queryGeneration
  if (loading.value) return
  const id = typeof route.query.deployment === 'string' ? route.query.deployment : ''
  const env = typeof route.query.env === 'string' ? route.query.env : ''
  const currentApp = appId.value
  selectedEnvId.value = environments.value.some(item => item.id === env) ? env : ''
  activeTab.value = route.query.tab === 'config' ? 'config' : 'source'
  if (!id) { selectedDeploymentId.value = deploymentsOfEnv(selectedEnvId.value)[0]?.id ?? ''; return }
  selectedDeploymentId.value = deploymentsOfEnv(selectedEnvId.value).some(item => item.id === id) ? id : ''
  if (deployments.value.some(item => item.id === id)) return
  try {
    const item = await getDeployment(id)
    if (token !== queryGeneration || currentApp !== appId.value) return
    if (item.appId === currentApp && bindings.value.some(binding => binding.id === item.bindingId)) {
      deployments.value = [...deployments.value, item]
      selectedDeploymentId.value = deploymentsOfEnv(selectedEnvId.value).some(record => record.id === id) ? id : ''
    }
  } catch { /* 无效深链保持空态，不能选中另一条发布。 */ }
})
onBeforeUnmount(() => { queryGeneration++ })

watch(
  appId,
  () => {
    selectedEnvId.value = ''
    selectedDeploymentId.value = ''
    promoteTargetId.value = ''
    rollbackReason.value = ''
    actionError.value = ''
    void loadAll()
  },
  { immediate: true },
)
</script>

<template>
  <div class="dh">
    <!-- 左列：环境选择 + 发布列表 -->
    <aside class="dh__side">
      <div class="dh__side-head">
        <p class="dh__side-title">选择环境</p>
        <t-select
          class="dh-env-select"
          :value="selectedEnvId"
          :options="envOptions"
          placeholder="Select..."
          clearable
          @change="onEnvChange"
        />
      </div>

      <ul v-if="selectedEnv && envDeployments.length" class="dh__deploys">
        <li v-for="item in envDeployments" :key="item.id">
          <button
            type="button"
            class="dh-row"
            :class="{ 'dh-row--active': item.id === selectedDeploymentId }"
            @click="selectDeployment(item.id)"
          >
            <span class="dh-row__icon" :class="`dh-row__icon--${toneOfStatus(item.status)}`">
              <t-icon
                :name="iconOfTone[toneOfStatus(item.status)]"
                size="16px"
                :class="toneOfStatus(item.status) === 'progress' ? 'dh-spin' : ''"
              />
            </span>
            <span class="dh-row__body">
              <span class="dh-row__time">{{ fmtWhen(item.createdAt) }}</span>
              <span class="dh-row__meta">
                {{ kindMap[item.kind] }} · {{ shortTag(item.imageRef) }} · {{ item.operator }}
              </span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="selectedEnv && !loading" class="dh__side-empty">该环境暂无发布记录</p>
    </aside>

    <!-- 右侧：时间线 + 页签 + 内容 -->
    <section class="dh__main">
      <header v-if="detail" class="dh-timeline">
        <div class="dh-steps">
          <div class="dh-step">
            <span class="dh-step__icon"><t-icon name="check-circle-filled" size="16px" /></span>
            <div class="dh-step__body">
              <div class="dh-step__line">
                <span class="dh-step__strong">触发</span>
                <span class="dh-step__dot">•</span>
                <span>{{ timelineKindMap[detail.kind] }}</span>
                <span class="dh-step__arrow">→</span>
                <span class="dh-step__strong">{{ envName }}</span>
                <span class="dh-step__meta">{{ fmtWhen(detail.createdAt) }}</span>
                <span class="dh-step__dot">•</span>
                <span class="dh-step__meta">{{ detail.operator }}</span>
                <span class="dh-chip" :title="detail.imageRef">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                    <rect x="1" y="1.5" width="2.2" height="2.2" rx="0.3" />
                    <rect x="4.9" y="1.5" width="2.2" height="2.2" rx="0.3" />
                    <rect x="8.8" y="1.5" width="2.2" height="2.2" rx="0.3" />
                    <rect x="1" y="5.4" width="2.2" height="2.2" rx="0.3" />
                    <rect x="4.9" y="5.4" width="2.2" height="2.2" rx="0.3" />
                    <rect x="8.8" y="5.4" width="2.2" height="2.2" rx="0.3" />
                    <rect x="1" y="9.3" width="10" height="1.6" rx="0.5" />
                  </svg>
                  <span>{{ shortTag(detail.imageRef) }}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="dh-step">
            <span class="dh-step__icon dh-step__icon--last" :class="`dh-step__icon--${statusInfo.tone}`">
              <t-icon
                :name="iconOfTone[statusInfo.tone]"
                size="16px"
                :class="statusInfo.tone === 'progress' ? 'dh-spin' : ''"
              />
            </span>
            <div class="dh-step__body">
              <div class="dh-step__line">
                <span class="dh-step__status" :class="`dh-step__status--${statusInfo.tone}`">
                  {{ statusInfo.label }}
                </span>
                <span class="dh-step__meta">{{ fmtWhen(detail.createdAt) }}</span>
              </div>
              <p
                v-if="detail.reason && (detail.status === 'failed' || detail.status === 'unknown')"
                class="dh-step__reason"
                :class="`dh-step__reason--${statusInfo.tone}`"
              >
                {{ detail.reason }}
              </p>
            </div>
          </div>
        </div>

        <div class="dh-actions">
          <t-button
            v-if="detail.status === 'unknown'"
            size="small"
            variant="outline"
            :loading="reconciling"
            @click="onReconcile"
          >
            核对结果
          </t-button>
          <t-button v-if="canPromote" size="small" variant="outline" @click="openPromote">晋级</t-button>
          <t-button v-if="canRollback" size="small" variant="outline" theme="danger" @click="openRollback">回滚</t-button>
        </div>
      </header>

      <nav v-if="selectedEnv" class="dh-tabs">
        <button
          type="button"
          class="dh-tab"
          :class="{ 'dh-tab--active': activeTab === 'source' }"
          @click="activeTab = 'source'"
        >
          源码
        </button>
        <button
          type="button"
          class="dh-tab"
          :class="{ 'dh-tab--active': activeTab === 'config' }"
          @click="activeTab = 'config'"
        >
          配置
        </button>
      </nav>

      <div class="dh-content" :class="{ 'dh-content--plain': !detail }">
        <div v-if="loading" class="dh-loading"><t-loading size="small" /><span>加载发布记录…</span></div>

        <div v-else-if="loadError" class="dh-loading">
          <t-icon name="error-circle" size="20px" class="dh-loading__error" />
          <span>{{ loadError }}</span>
          <t-button size="small" variant="outline" @click="loadAll">重试</t-button>
        </div>

        <!-- 未选环境 / 无发布：空态 -->
        <div v-else-if="!selectedEnv" class="dh-empty">
          <svg class="dh-empty__art" viewBox="0 0 240 150" fill="none" aria-hidden="true">
            <rect x="52" y="18" width="44" height="30" rx="4" fill="#1c3f8f" />
            <path d="M67 28l14 14M81 28L67 42" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
            <rect x="110" y="8" width="44" height="30" rx="4" fill="#1c3f8f" />
            <circle cx="132" cy="23" r="8" fill="#f4a623" />
            <path d="M132 18.5v5.5" stroke="#1c3f8f" stroke-width="2" stroke-linecap="round" />
            <circle cx="132" cy="27.5" r="1.2" fill="#1c3f8f" />
            <rect x="184" y="82" width="4" height="30" rx="2" fill="#c7d3e8" />
            <rect x="148" y="108" width="40" height="4" rx="2" fill="#c7d3e8" />
            <rect x="185" y="112" width="3" height="12" fill="#c7d3e8" />
            <circle cx="165" cy="62" r="10" fill="#f6b48c" />
            <path d="M154 64c0-9 5-14 11-14s11 5 11 14c-3-6-6-8-11-8s-8 2-11 8Z" fill="#d6452f" />
            <rect x="161" y="70" width="8" height="10" fill="#f6b48c" />
            <path d="M153 108c0-16 5-28 12-28s12 12 12 28h-24Z" fill="#1f5bd6" />
            <path d="M156 90c-9 2-18 6-24 8" stroke="#1f5bd6" stroke-width="6" stroke-linecap="round" />
            <path d="M164 108h-21" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" />
            <path d="M143 108v20" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" />
            <rect x="135" y="126" width="15" height="4" rx="2" fill="#0f2350" />
            <rect x="88" y="76" width="40" height="28" rx="2" fill="#12306b" />
            <path d="M82 104h52l-3 3H85l-3-3Z" fill="#9fb2d4" />
            <rect x="40" y="118" width="160" height="3" rx="1.5" fill="#c7d3e8" />
            <rect x="50" y="121" width="3" height="20" fill="#c7d3e8" />
            <rect x="187" y="121" width="3" height="20" fill="#c7d3e8" />
          </svg>
          <p class="dh-empty__title">
            {{ environments.length ? '未选择环境' : '没有可用环境' }}
          </p>
          <p class="dh-empty__desc">
            {{
              environments.length
                ? '请选择一个环境，查看该环境的发布记录。'
                : 'Create an environment and bind this application first.'
            }}
          </p>
        </div>

        <div v-else-if="!detail" class="dh-empty">
          <svg class="dh-empty__art" viewBox="0 0 240 150" fill="none" aria-hidden="true">
            <rect x="52" y="18" width="44" height="30" rx="4" fill="#1c3f8f" />
            <path d="M67 28l14 14M81 28L67 42" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
            <rect x="110" y="8" width="44" height="30" rx="4" fill="#1c3f8f" />
            <circle cx="132" cy="23" r="8" fill="#f4a623" />
            <path d="M132 18.5v5.5" stroke="#1c3f8f" stroke-width="2" stroke-linecap="round" />
            <circle cx="132" cy="27.5" r="1.2" fill="#1c3f8f" />
            <rect x="184" y="82" width="4" height="30" rx="2" fill="#c7d3e8" />
            <rect x="148" y="108" width="40" height="4" rx="2" fill="#c7d3e8" />
            <rect x="185" y="112" width="3" height="12" fill="#c7d3e8" />
            <circle cx="165" cy="62" r="10" fill="#f6b48c" />
            <path d="M154 64c0-9 5-14 11-14s11 5 11 14c-3-6-6-8-11-8s-8 2-11 8Z" fill="#d6452f" />
            <rect x="161" y="70" width="8" height="10" fill="#f6b48c" />
            <path d="M153 108c0-16 5-28 12-28s12 12 12 28h-24Z" fill="#1f5bd6" />
            <path d="M156 90c-9 2-18 6-24 8" stroke="#1f5bd6" stroke-width="6" stroke-linecap="round" />
            <path d="M164 108h-21" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" />
            <path d="M143 108v20" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" />
            <rect x="135" y="126" width="15" height="4" rx="2" fill="#0f2350" />
            <rect x="88" y="76" width="40" height="28" rx="2" fill="#12306b" />
            <path d="M82 104h52l-3 3H85l-3-3Z" fill="#9fb2d4" />
            <rect x="40" y="118" width="160" height="3" rx="1.5" fill="#c7d3e8" />
            <rect x="50" y="121" width="3" height="20" fill="#c7d3e8" />
            <rect x="187" y="121" width="3" height="20" fill="#c7d3e8" />
          </svg>
          <p class="dh-empty__title">No deployment found</p>
          <p class="dh-empty__desc">This environment has no CD deployment yet. Pick another environment from the list.</p>
        </div>

        <!-- Source 页签 -->
        <div v-else-if="activeTab === 'source'" class="dh-source">
          <BuildSourceSnapshot :build="detailBuild" :show-build-config="false" />

          <div class="dh-chain" aria-hidden="true">
            <span class="dh-chain__line"></span>
            <span class="dh-chain__node"><t-icon name="arrow-down" size="12px" /></span>
            <span class="dh-chain__line"></span>
          </div>

          <ArtifactSummaryCard class="dh-card dh-artifact" :artifact="detailArtifact" :fallback-image="detail.imageRef" show-details @edit="openLabel" @details="imageDetailsVisible = true" />
        </div>

        <!-- Configuration 页签 -->
        <div v-else class="dh-config">
          <p class="dh-cfg-title">Configurations used for this deployment trigger</p>
          <p v-if="configDrift" class="dh-drift">
            本次部署使用配置 v{{ detail.configVersion }}，当前应用配置已更新到 v{{ config?.version }}。
          </p>

          <section class="dh-card dh-spec">
            <div class="dh-spec__field dh-spec__field--wide">
              <span class="dh-spec__label">Image</span>
              <button type="button" class="dh-spec__value dh-mono dh-image-link" @click="imageDetailsVisible = true">{{ detail.imageRef }}</button>
              <span v-if="detailArtifact" class="dh-spec__sub dh-mono">
                digest {{ shortDigest(detailArtifact.digest) }}
              </span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Config version</span>
              <span class="dh-spec__value"><span class="dh-pill">v{{ detail.configVersion }}</span></span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Helm revision</span>
              <span class="dh-spec__value">{{ detail.helmRevision ?? '—' }}</span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Cluster / Namespace</span>
              <span class="dh-spec__value dh-mono">
                {{ historicalTarget ? `${historicalTarget.clusterId} / ${historicalTarget.namespace}` : '未记录' }}
              </span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Release name</span>
              <span class="dh-spec__value dh-mono">{{ historicalTarget?.releaseName ?? '未记录' }}</span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Deployment type</span>
              <span class="dh-spec__value">{{ timelineKindMap[detail.kind] }}</span>
            </div>
            <div class="dh-spec__field">
              <span class="dh-spec__label">Strategy</span>
              <span class="dh-spec__value">{{ strategyMap[detail.strategy ?? 'rolling'] }}</span>
            </div>
            <div class="dh-spec__field dh-spec__field--wide">
              <span class="dh-spec__label">触发人</span>
              <span class="dh-spec__value">{{ detail.operator }} · {{ fmtWhen(detail.createdAt) }}</span>
            </div>
            <div class="dh-spec__field dh-spec__field--wide">
              <span class="dh-spec__label">Status</span>
              <span class="dh-spec__value">
                <span class="dh-status-dot" :class="`dh-status-dot--${statusInfo.tone}`"></span>
                {{ statusInfo.label }}
                <span v-if="detail.reason" class="dh-spec__hint">{{ detail.reason }}</span>
              </span>
            </div>
          </section>

          <DeploymentSnapshotPanel :key="detail.id" :deployment="detail" :binding="detailBinding" />

          <section v-if="canary" class="dh-card dh-canary">
            <div class="dh-canary__head">
              <span class="dh-canary__title">灰度进度</span>
              <span class="dh-canary__hint">
                第 {{ canary.currentStep + 1 }} / {{ canary.steps.length }} 档 · 当前
                {{ canary.steps[canary.currentStep] }}%
              </span>
            </div>
            <div class="dh-canary__steps">
              <span
                v-for="(step, index) in canary.steps"
                :key="step"
                class="dh-canary__step"
                :class="{
                  'dh-canary__step--done': index <= canary.currentStep,
                  'dh-canary__step--current': index === canary.currentStep,
                }"
              >
                {{ step }}%
              </span>
            </div>
            <div class="dh-canary__actions">
              <t-button
                v-if="canAdvanceCanary"
                size="small"
                theme="primary"
                variant="outline"
                :loading="advancing"
                @click="onAdvanceCanary"
              >
                推进到 {{ canary.steps[canary.currentStep + 1] }}%
              </t-button>
              <span v-else-if="detail.status !== 'observing'" class="dh-canary__hint">
                灰度已结束（{{ statusInfo.label }}）。
              </span>
              <span v-else class="dh-canary__hint">已到最后一档，等待观察窗口结束。</span>
            </div>
          </section>

          <p v-if="actionError" class="dh-action-error">
            {{ actionError }}
            <span v-if="actionErrorCode" class="dh-mono">（{{ actionErrorCode }}）</span>
          </p>
        </div>

        <p v-if="detail && activeTab === 'source' && actionError" class="dh-action-error">
          {{ actionError }}
          <span v-if="actionErrorCode" class="dh-mono">（{{ actionErrorCode }}）</span>
        </p>
      </div>
    </section>
  </div>

  <!-- 晋级 -->
  <t-dialog
    v-model:visible="promoteOpen"
    header="晋级到其他环境"
    width="480px"
    :footer="false"
    :close-on-overlay-click="false"
  >
    <div class="dh-dialog">
      <p class="dh-dialog__hint">复用当前镜像与配置版本，在目标环境新建 release。</p>
      <t-select
        :value="promoteTargetId"
        :options="promoteOptions"
        placeholder="选择目标环境"
        @change="onPromoteTargetChange"
      />
      <p v-if="actionError" class="dh-dialog__error">
        {{ actionError }}
        <span v-if="actionErrorCode" class="dh-mono">（{{ actionErrorCode }}）</span>
      </p>
      <div class="dh-dialog__foot">
        <t-button variant="outline" @click="promoteOpen = false">取消</t-button>
        <t-button theme="primary" :disabled="!promoteTargetId || acting" :loading="acting" @click="onPromote">
          确认晋级
        </t-button>
      </div>
    </div>
  </t-dialog>

  <!-- 回滚 -->
  <t-dialog
    v-model:visible="rollbackOpen"
    header="回滚到此版本"
    width="480px"
    :footer="false"
    :close-on-overlay-click="false"
  >
    <div class="dh-dialog">
      <p class="dh-dialog__hint">填写回滚原因，将在同一环境重新发布该镜像。</p>
      <t-input v-model="rollbackReason" placeholder="回滚原因（必填）" />
      <p v-if="actionError" class="dh-dialog__error">
        {{ actionError }}
        <span v-if="actionErrorCode" class="dh-mono">（{{ actionErrorCode }}）</span>
      </p>
      <div class="dh-dialog__foot">
        <t-button variant="outline" @click="rollbackOpen = false">取消</t-button>
        <t-button
          theme="danger"
          :disabled="!rollbackReason.trim() || acting"
          :loading="acting"
          @click="onRollback"
        >
          确认回滚
        </t-button>
      </div>
    </div>
  </t-dialog>

  <!-- 标签 / 备注 -->
  <ArtifactMetadataDialog v-model:visible="labelOpen" :artifact="detailArtifact" @saved="artifactSaved" />
  <ArtifactDetailsDrawer v-model:visible="imageDetailsVisible" :app-id="appId" :artifact-id="detail?.artifactId || ''" :fallback-image="detail?.imageRef" :deployment="detail" :environment-name="envName" @saved="artifactSaved" />
</template>

<style scoped>
.dh-image-link{border:0;background:none;padding:0;text-align:left;cursor:pointer;color:#0066cc;font:inherit;overflow-wrap:anywhere}
/* ---------------- 整页骨架 ---------------- */
.dh {
  display: grid;
  grid-template-columns: 296px minmax(0, 1fr);
  height: calc(100dvh - 102px);
  min-height: 480px;
  margin: -12px -16px -24px;
  overflow: hidden;
  color: #000a14;
  background: #ffffff;
}

/* ---------------- 左列 ---------------- */
.dh__side {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  background: #ffffff;
  border-right: 1px solid #e6e9ef;
}
.dh__side-head {
  padding: 12px 16px 10px;
  border-bottom: 1px solid #e6e9ef;
}
.dh__side-title {
  margin: 0 0 8px;
  color: #596168;
  font-size: 12px;
  line-height: 16px;
}
.dh-env-select {
  width: 100%;
}
.dh-env-select :deep(.t-input) {
  height: 36px;
  min-height: 36px;
  padding: 0 10px;
  font-size: 13px;
  border-color: #d0d4d9;
  border-radius: 4px;
}
.dh-env-select :deep(.t-input:hover) {
  border-color: #0066cc;
}
.dh__deploys {
  display: flex;
  flex-direction: column;
}
.dh__side-empty {
  margin: 12px 16px;
  color: #596168;
  font-size: 12px;
}
.dh-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  padding: 10px 16px;
  font: inherit;
  color: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
.dh-row:hover {
  background: #f7f9fc;
}
.dh-row--active {
  background: #f0f7ff;
}
.dh-row__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 18px;
  color: #8a94a6;
}
.dh-row__icon--success {
  color: #2ba471;
}
.dh-row__icon--failed {
  color: #d54941;
}
.dh-row__icon--progress,
.dh-row__icon--unknown {
  color: #e37318;
}
.dh-row__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dh-row__time {
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.dh-row__meta {
  overflow: hidden;
  color: #596168;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------------- 右侧主区 ---------------- */
.dh__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
}
.dh-timeline {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 12px 24px;
}
.dh-steps {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.dh-step {
  position: relative;
  display: flex;
  gap: 13px;
  align-items: flex-start;
  min-width: 0;
}
.dh-step:first-child::after {
  content: '';
  position: absolute;
  top: 20px;
  left: 7px;
  width: 1px;
  height: 16px;
  background: #c7ced9;
}
.dh-step__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 18px;
  color: #2ba471;
}
.dh-step__icon--success {
  color: #2ba471;
}
.dh-step__icon--failed {
  color: #d54941;
}
.dh-step__icon--progress,
.dh-step__icon--unknown {
  color: #e37318;
}
.dh-step__body {
  min-width: 0;
}
.dh-step__line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 18px;
  color: #3b444c;
  font-size: 13px;
  line-height: 18px;
}
.dh-step__strong {
  color: #000a14;
  font-weight: 600;
}
.dh-step__dot {
  color: #8a94a6;
}
.dh-step__arrow {
  color: #596168;
}
.dh-step__meta {
  color: #596168;
  font-size: 12px;
}
.dh-step__status {
  font-weight: 600;
}
.dh-step__status--success {
  color: #2ba471;
}
.dh-step__status--failed {
  color: #d54941;
}
.dh-step__status--progress,
.dh-step__status--unknown {
  color: #e37318;
}
.dh-step__reason {
  margin: 4px 0 0;
  color: #d54941;
  font-size: 12px;
  line-height: 16px;
}
.dh-step__reason--unknown {
  color: #e37318;
}
.dh-chip {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  color: #0066cc;
  font-family: var(--tk-mono);
  font-size: 11px;
  background: #eaf2ff;
  border-radius: 3px;
}
.dh-chip svg {
  flex: none;
  color: #2f7bff;
}
.dh-actions {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding-top: 1px;
}
.dh-spin {
  animation: dh-spin 1.1s linear infinite;
}
@keyframes dh-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------------- 页签 ---------------- */
.dh-tabs {
  display: flex;
  gap: 24px;
  align-items: center;
  height: 44px;
  padding: 0 24px 0 53px;
  background: #ffffff;
  border-bottom: 1px solid #e6e9ef;
}
.dh-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0;
  color: #3b444c;
  font: inherit;
  font-size: 13px;
  background: none;
  border: 0;
  cursor: pointer;
}
.dh-tab:hover {
  color: #0066cc;
}
.dh-tab--active {
  color: #0066cc;
  font-weight: 600;
}
.dh-tab--active::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: #0066cc;
}

/* ---------------- 内容区 ---------------- */
.dh-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 16px 20px;
  overflow: auto;
  background: #f2f4f7;
}
.dh-content--plain {
  background: #ffffff;
}
.dh-loading {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: #596168;
  font-size: 13px;
}
.dh-loading__error {
  color: #d54941;
}

/* ---------------- 空态 ---------------- */
.dh-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 24px 24px 64px;
  text-align: center;
}
.dh-empty__art {
  width: 240px;
  height: 150px;
  margin-bottom: 10px;
}
.dh-empty__title {
  margin: 0;
  color: #3b444c;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}
.dh-empty__desc {
  max-width: 340px;
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}

/* ---------------- Source ---------------- */
.dh-source {
  display: flex;
  flex-direction: column;
}
.dh-card {
  max-width: 800px;
  background: #ffffff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
}
.dh-repo {
  display: flex;
  gap: 7px;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  font-size: 13px;
  border-bottom: 1px solid #e6e9ef;
}
.dh-repo__icon {
  color: #24292f;
}
.dh-repo__name {
  color: #000a14;
  font-weight: 600;
}
.dh-repo__slash {
  color: #8a94a6;
}
.dh-repo__branch-icon,
.dh-repo__branch {
  color: #3b444c;
  font-size: 12px;
}
.dh-repo__info {
  margin-left: 2px;
  color: #8a94a6;
  cursor: help;
}
.dh-commit {
  padding: 14px 16px 16px;
}
.dh-sha {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  color: #0066cc;
  font-family: var(--tk-mono);
  font-size: 11px;
  background: #eaf2ff;
  border-radius: 3px;
}
.dh-commit__subject {
  margin: 10px 0 8px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  word-break: break-word;
}
.dh-commit__line {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 4px;
  color: #596168;
  font-size: 12px;
  line-height: 16px;
}
.dh-commit__line:last-child {
  margin-bottom: 0;
}
.dh-commit__empty {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.dh-chain {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  max-width: 800px;
  height: 46px;
  padding: 0;
}
.dh-chain__line {
  flex: 1;
  height: 0;
  border-top: 1px dashed #c7ced9;
}
.dh-chain__node {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #596168;
  background: #ffffff;
  border: 1px solid #d0d4d9;
  border-radius: 50%;
}
.dh-artifact {
  padding: 14px 16px 16px;
}
.dh-artifact__main {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.dh-artifact__badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: #eaf2ff;
  border-radius: 4px;
}
.dh-artifact__body {
  min-width: 0;
}
.dh-artifact__tag {
  display: flex;
  gap: 5px;
  align-items: center;
  margin: 1px 0 2px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.dh-artifact__ref {
  display: flex;
  gap: 5px;
  align-items: center;
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 16px;
  word-break: break-all;
}
.dh-copy {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 2px;
  color: #8a94a6;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.dh-copy:hover {
  color: #0066cc;
  background: #f2f4f7;
}
.dh-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 12px;
}
.dh-label {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  color: #3b444c;
  font-size: 11px;
  background: #f2f4f7;
  border: 1px solid #e6e9ef;
  border-radius: 3px;
}
.dh-addlabel {
  height: 22px;
  padding: 0 8px;
  color: #3b444c;
  font: inherit;
  font-size: 12px;
  background: none;
  border: 1px dashed #d0d4d9;
  border-radius: 3px;
  cursor: pointer;
}
.dh-addlabel:hover {
  color: #0066cc;
  border-color: #0066cc;
}

/* ---------------- Configuration ---------------- */
.dh-config {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.dh-cfg-title {
  margin: 0 0 10px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.dh-cfg-title--sub {
  margin-top: 18px;
}
.dh-drift {
  margin: -2px 0 10px;
  padding: 6px 10px;
  color: #e37318;
  font-size: 12px;
  line-height: 16px;
  background: #fff7ec;
  border: 1px solid #f5d3ac;
  border-radius: 3px;
}
.dh-config .dh-card {
  width: 100%;
}
.dh-spec {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 24px;
  padding: 14px 16px;
}
.dh-spec__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.dh-spec__field--wide {
  grid-column: 1 / -1;
}
.dh-spec__label {
  color: #596168;
  font-size: 11px;
  line-height: 15px;
}
.dh-spec__value {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: #000a14;
  font-size: 12px;
  line-height: 16px;
  word-break: break-all;
}
.dh-spec__sub {
  color: #8a94a6;
  font-size: 11px;
}
.dh-spec__value.dh-mono,
.dh-spec__value .dh-mono {
  font-size: 12px;
}
.dh-spec__hint {
  color: #596168;
}
.dh-cfg-empty {
  grid-column: 1 / -1;
  margin: 0;
  color: #596168;
  font-size: 12px;
}
.dh-mono {
  font-family: var(--tk-mono);
  font-size: 11px;
}
.dh-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  color: #0066cc;
  font-family: var(--tk-mono);
  font-size: 11px;
  background: #eaf2ff;
  border-radius: 3px;
}
.dh-badge {
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 5px;
  color: #596168;
  font-size: 11px;
  background: #f2f4f7;
  border: 1px solid #e6e9ef;
  border-radius: 2px;
}
.dh-badge--override {
  color: #0066cc;
  background: #eaf2ff;
  border-color: #cfe2ff;
}
.dh-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 2px;
  border-radius: 50%;
}
.dh-status-dot--success {
  background: #2ba471;
}
.dh-status-dot--failed {
  background: #d54941;
}
.dh-status-dot--progress,
.dh-status-dot--unknown {
  background: #e37318;
}
.dh-canary {
  width: 100%;
  margin-top: 18px;
  padding: 12px 14px;
}
.dh-canary__head {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.dh-canary__title {
  font-size: 13px;
  font-weight: 600;
}
.dh-canary__hint {
  color: #596168;
  font-size: 12px;
}
.dh-canary__steps {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}
.dh-canary__step {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  color: #596168;
  font-size: 11px;
  background: #ffffff;
  border: 1px solid #d0d4d9;
  border-radius: 10px;
}
.dh-canary__step--done {
  color: #0066cc;
  background: #eaf2ff;
  border-color: #cfe2ff;
}
.dh-canary__step--current {
  color: #ffffff;
  background: #0066cc;
  border-color: #0066cc;
}
.dh-canary__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dh-action-error {
  max-width: 800px;
  margin: 12px 0 0;
  color: #d54941;
  font-size: 12px;
  line-height: 16px;
}

/* ---------------- 弹窗 ---------------- */
.dh-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}
.dh-dialog__hint {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.dh-dialog__error {
  margin: 0;
  color: #d54941;
  font-size: 12px;
  line-height: 16px;
}
.dh-dialog__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
</style>
