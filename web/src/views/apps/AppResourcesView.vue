<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQuery, RouteLocationRaw } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import type { SelectValue } from 'tdesign-vue-next'

import {
  deleteRelease,
  getAppMonitoring,
  getApplication,
  listApplicationResources,
  listArtifacts,
  listBindings,
  listBuilds,
  listDeployments,
  listEnvironments,
  restartWorkloads,
  scanVulnerabilities,
  setWorkloadsHibernation,
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ReleaseNotesDrawer from '@/components/application/ReleaseNotesDrawer.vue'
import Sparkline from '@/components/Sparkline.vue'
import StatusTag from '@/components/StatusTag.vue'
import ErrorState from '@/components/ErrorState.vue'
import K8sKindTree from '@/components/K8sKindTree.vue'
import ResourceDetailPanel from '@/components/resource/ResourceDetailPanel.vue'
import ResourceWorkspaceTabs from '@/components/resource/ResourceWorkspaceTabs.vue'
import { useResourceTabRefresh } from '@/composables/useResourceTabRefresh'
import { useResourceDetailLocation } from '@/composables/useResourceDetailLocation'
import { resourceDetailQuery } from '@/utils/resourceDetailLocation'
import ResourceActionDialog from '@/components/resource/ResourceActionDialog.vue'
import ResourceHierarchy from '@/components/resource/ResourceHierarchy.vue'
import LogAnalyzerWorkspace from '@/components/resource/LogAnalyzerWorkspace.vue'
import type {
  Artifact,
  Binding,
  Build,
  Deployment,
  Environment,
  Health,
  K8sResource,
  ResourceType,
} from '@/types'
import { useResourceTabsStore } from '@/stores/resourceTabs'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import { deployStatusMap, fmtRelative, healthMap } from '@/utils/format'
import { resourceTypeKey } from '@/utils/resourceListing'

/** resource-detail 路由的 :group 段不能为空，核心组（group 为空串）用 `core` 占位 */
const CORE_GROUP = 'core'
const KIND_ORDER = ['Deployment', 'Job', 'Pod', 'Service', 'Ingress', 'ConfigMap', 'Secret', 'PersistentVolumeClaim', 'Node']
const KIND_CATEGORY: Record<string, string> = {
  Deployment: 'Workloads',
  Job: 'Workloads',
  Pod: 'Workloads',
  StatefulSet: 'Workloads',
  DaemonSet: 'Workloads',
  ReplicaSet: 'Workloads',
  CronJob: 'Workloads',
  Service: 'Networking',
  Ingress: 'Networking',
  Endpoints: 'Networking',
  EndpointSlice: 'Networking',
  ConfigMap: 'Config & Storage',
  Secret: 'Config & Storage',
  PersistentVolumeClaim: 'Config & Storage',
  Node: 'Cluster',
  Namespace: 'Cluster',
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const projectId = computed(() => String(route.params.projectId ?? ''))
const baseParams = computed(() => ({ projectId: projectId.value, appId: appId.value }))

const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const deployments = ref<Deployment[]>([])
const artifacts = ref<Artifact[]>([])
const builds = ref<Build[]>([])
const health = ref<Health>('unknown')
const appName = ref('')
const bindLoading = ref(true)
const bindError = ref('')
const activeBindingId = ref('')

const resources = ref<K8sResource[]>([])
const resLoading = ref(false)
const resError = ref('')
const activeResource = ref('')
const activeGroup = ref('')
const podTab = ref<'new' | 'old'>('new')

const tabsStore = useResourceTabsStore()
const resourcePanel = useTemplateRef<InstanceType<typeof ResourceDetailPanel>>('resourcePanel')
async function canLeavePanel(): Promise<boolean> { return await (resourcePanel.value?.requestLeave() ?? true) }

const deleteVisible = ref(false)
const deleteTarget = ref<K8sResource | null>(null)

/* 环境对比 / 健康明细 / 日志分析（日志分析是页签，不是弹窗） */
const compareVisible = ref(false)
const healthVisible = ref(false)

type AppView = 'resources' | 'analyzer'
const compareRows = computed(() =>
  bindings.value.map((binding) => {
    const env = environments.value.find((item) => item.id === binding.environmentId)
    const latest = deployments.value
      .filter((item) => item.bindingId === binding.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return {
      id: binding.id,
      envName: env?.name ?? binding.environmentId,
      production: env?.production ?? false,
      clusterId: binding.target.clusterId,
      namespace: binding.target.namespace,
      releaseName: binding.target.releaseName,
      imageRef: latest?.imageRef ?? '—',
      configVersion: latest ? `v${latest.configVersion}` : '—',
      status: latest ? deployStatusMap[latest.status].label : '未发布',
    }
  }),
)

/* 应用状态抽屉（对齐 Devtron：Application Status / Deployment Status 两个页签） */
type HealthTab = 'app' | 'deploy'
type HealthFilter = 'all' | 'healthy' | 'unhealthy'

const healthTab = ref<HealthTab>('app')
const healthFilter = ref<HealthFilter>('all')

const strategyMap: Record<string, string> = {
  rolling: '滚动发布',
  canary: '灰度发布',
  bluegreen: '蓝绿发布',
}

function strategyLabel(strategy?: string): string {
  return strategyMap[strategy ?? 'rolling'] ?? '滚动发布'
}

const HEALTHY_STATUSES = ['Healthy', 'Running', 'Available', 'Active', 'Ready', 'Succeeded', 'Completed', 'Bound']

const healthRows = computed(() =>
  resources.value.map((item) => {
    const healthy = HEALTHY_STATUSES.includes(item.status) || ['Running'].includes(item.status)
    return {
      id: item.ref.uid,
      kind: item.kind,
      name: item.ref.name,
      status: item.status,
      message: healthy ? '' : item.status === 'CrashLoopBackOff' ? '容器反复重启' : '状态异常，需检查事件',
      healthy,
    }
  }),
)

const healthyCount = computed(() => healthRows.value.filter((row) => row.healthy).length)
const unhealthyCount = computed(() => healthRows.value.length - healthyCount.value)

const visibleHealthRows = computed(() => {
  if (healthFilter.value === 'healthy') return healthRows.value.filter((row) => row.healthy)
  if (healthFilter.value === 'unhealthy') return healthRows.value.filter((row) => !row.healthy)
  return healthRows.value
})

const latestDeployment = computed<Deployment | null>(() => {
  const bindingId = activeBinding.value?.id
  if (!bindingId) return null
  return (
    deployments.value
      .filter((item) => item.bindingId === bindingId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
})

/** 当前环境已部署镜像对应的构建（Devtron 的 “Deployed commit” 卡） */
const deployedBuild = computed<Build | null>(() => {
  const deployment = latestDeployment.value
  if (!deployment) return null
  const artifact = artifacts.value.find((item) => item.id === deployment.artifactId)
  if (!artifact?.buildId) return null
  return builds.value.find((item) => item.id === artifact.buildId) ?? null
})

/** 当前环境最近的发布记录（用于 Deployment Status 页签的历史表） */
const bindingDeployments = computed(() =>
  activeBinding.value
    ? deployments.value
        .filter((item) => item.bindingId === activeBinding.value?.id)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
    : [],
)

async function copyPageLink(): Promise<void> {
  if (!navigator.clipboard) {
    MessagePlugin.warning('当前环境不支持自动复制，请手动复制地址栏')
    return
  }
  try {
    await navigator.clipboard.writeText(window.location.href)
    MessagePlugin.success('已复制页面链接')
  } catch {
    MessagePlugin.error('复制失败，请手动复制地址栏')
  }
}

async function refreshPage(): Promise<void> {
  if (!(await canLeavePanel())) return
  await loadBindings()
  await loadResources()
  MessagePlugin.success('已刷新')
}

/** 视图：K8s 资源 / 日志分析（都作为页签，可深链 ?view=analyzer） */
const appView = computed<AppView>(() => (String(route.query.view ?? '') === 'analyzer' ? 'analyzer' : 'resources'))

const analyzerAvailable = computed(() => resources.value.some(item => item.kind === 'Pod'))
const analyzerRefreshKey = ref(0)

function setAppView(view: AppView): void {
  const query = resourceDetailQuery(route.query)
  delete query.tab
  if (view === 'analyzer') query.view = 'analyzer'
  else delete query.view
  void router.replace({ query })
}

async function openAnalyzer(): Promise<void> {
  if (!(await canLeavePanel())) return
  setAppView('analyzer')
}

const activeBinding = computed(() => bindings.value.find((item) => item.id === activeBindingId.value) ?? null)
const clusterId = computed(() => activeBinding.value?.target.clusterId ?? '')
const namespaceName = computed(() => activeBinding.value?.target.namespace ?? '')

const envOptions = computed(() =>
  bindings.value.map((binding) => ({
    label: envNameOf(binding.environmentId),
    value: binding.id,
  })),
)

const healthEntry = computed(() => healthMap[health.value])

/* ---------- 环境级动作：Restart workloads / Hibernate / Delete release ---------- */
type WorkloadModal = 'restart' | 'hibernate'

const workloadModal = ref<WorkloadModal | null>(null)
const workloadModalVisible = computed({
  get: () => workloadModal.value !== null,
  set: (value: boolean) => {
    if (!value) workloadModal.value = null
  },
})
const selectedWorkloads = ref<string[]>([])
const workloadSaving = ref(false)
const hibernated = ref(false)
const notesVisible = ref(false)
const releaseDeleteVisible = ref(false)
const releaseDeleteConfirm = ref('')
const releaseDeleting = ref(false)

const workloadOptions = computed(() =>
  resources.value
    .filter((item) => ['Deployment', 'StatefulSet', 'DaemonSet'].includes(item.kind))
    .map((item) => ({ label: `${item.kind} / ${item.ref.name}`, value: item.ref.name })),
)

function openWorkloadModal(mode: WorkloadModal): void {
  workloadModal.value = mode
  selectedWorkloads.value = workloadOptions.value.map((item) => item.value)
}

async function submitWorkloads(): Promise<void> {
  if (!workloadModal.value || !activeBinding.value) return
  if (!selectedWorkloads.value.length) {
    MessagePlugin.warning('请至少选择一个工作负载')
    return
  }
  workloadSaving.value = true
  try {
    if (workloadModal.value === 'restart') {
      const result = await restartWorkloads(appId.value, activeBinding.value.id, selectedWorkloads.value)
      MessagePlugin.success(`已提交重启（${result.workloads.length} 个工作负载，操作 ${result.operationId}）`)
    } else {
      const next = !hibernated.value
      await setWorkloadsHibernation(appId.value, activeBinding.value.id, selectedWorkloads.value, next)
      hibernated.value = next
      MessagePlugin.success(next ? '已提交 Hibernate（副本数缩到 0）' : '已提交 Unhibernate（恢复副本数）')
    }
    workloadModal.value = null
    await loadResources()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    workloadSaving.value = false
  }
}

async function confirmReleaseDelete(): Promise<void> {
  if (!activeBinding.value) return
  if (releaseDeleteConfirm.value.trim() !== appName.value) {
    MessagePlugin.warning('请输入应用名称以确认删除')
    return
  }
  releaseDeleting.value = true
  try {
    const result = await deleteRelease(appId.value, activeBinding.value.id, true)
    MessagePlugin.success(`已删除 release（操作 ${result.operationId}）`)
    releaseDeleteVisible.value = false
    releaseDeleteConfirm.value = ''
    await loadResources()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    releaseDeleting.value = false
  }
}

/* Pod 行菜单：Check vulnerabilities */
const vulnVisible = ref(false)
const vulnLoading = ref(false)
const vulnResult = ref<Awaited<ReturnType<typeof scanVulnerabilities>> | null>(null)

async function openVulnerabilities(resource: K8sResource): Promise<void> {
  const image = /image:\s*(\S+)/.exec(resource.manifest ?? '')?.[1] ?? 'unknown:latest'
  vulnVisible.value = true
  vulnLoading.value = true
  vulnResult.value = null
  try {
    vulnResult.value = await scanVulnerabilities(appId.value, image)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '扫描失败')
  } finally {
    vulnLoading.value = false
  }
}

function onEnvAction(data: { value?: string }): void {
  const value = String(data.value ?? '')
  if (value === 'restart') openWorkloadModal('restart')
  else if (value === 'hibernate') openWorkloadModal('hibernate')
  else if (value === 'delete-release') {
    releaseDeleteConfirm.value = ''
    releaseDeleteVisible.value = true
  }
}

function onNodeMenu(resource: K8sResource, action: 'vulnerabilities' | 'delete'): void {
  if (action === 'vulnerabilities') {
    void openVulnerabilities(resource)
    return
  }
  deleteTarget.value = resource
  deleteVisible.value = true
}

/* MONITORING 区（对齐 Devtron App Details） */
const monitoring = ref<Awaited<ReturnType<typeof getAppMonitoring>> | null>(null)
const monitoringOpen = ref(true)

async function loadMonitoring(): Promise<void> {
  if (!activeBinding.value) {
    monitoring.value = null
    return
  }
  try {
    monitoring.value = await getAppMonitoring(appId.value, activeBinding.value.id)
  } catch {
    monitoring.value = null
  }
}

const deployState = computed(() => (latestDeployment.value ? deployStatusMap[latestDeployment.value.status] : null))

/** 左侧 Kind 树：只列出当前环境实际存在的资源类型 */
const kindTypes = computed<ResourceType[]>(() => {
  const map = new Map<string, K8sResource>()
  for (const item of resources.value) {
    if (!map.has(resourceTypeKey(item.ref))) map.set(resourceTypeKey(item.ref), item)
  }
  const items = [...map.values()]
  const order = (resource: K8sResource) => {
    const index = KIND_ORDER.indexOf(resource.kind)
    return index === -1 ? KIND_ORDER.length : index
  }
  return items
    .sort((a, b) => order(a) - order(b) || a.ref.resource.localeCompare(b.ref.resource))
    .map((item) => ({
      group: item.ref.group,
      version: item.ref.version,
      resource: item.ref.resource,
      kind: item.kind,
      namespaced: item.ref.namespace !== '_cluster',
      verbs: [],
      category: KIND_CATEGORY[item.kind] ?? '其他',
    }))
})

const kindCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const item of resources.value) { const key = resourceTypeKey(item.ref); counts[key] = (counts[key] ?? 0) + 1 }
  return counts
})

const activeKind = computed(
  () => kindTypes.value.find((item) => item.resource === activeResource.value && item.group === activeGroup.value)?.kind ?? '资源',
)

const isPodKind = computed(() => activeKind.value === 'Pod')

/** 当前 Kind + Namespace 过滤后的行；Pod 的 New/Old 子页签在 rows 上再切一刀 */
const scopedRows = computed(() =>
  resources.value.filter((item) => item.ref.resource === activeResource.value && item.ref.group === activeGroup.value),
)

const rows = computed(() => (isPodKind.value && podTab.value === 'old' ? [] : scopedRows.value))
const healthyRows = computed(
  () => scopedRows.value.filter((row) => ['Running', 'Available', 'Active', 'Ready', 'Healthy', 'Succeeded'].includes(row.status)).length,
)
const runningCount = computed(() => scopedRows.value.filter((item) => item.status === 'Running').length)
const emptyTitle = computed(() =>
  isPodKind.value && podTab.value === 'old' ? '暂无历史 Pod' : '没有匹配的资源',
)
const emptyDesc = computed(() =>
  isPodKind.value && podTab.value === 'old'
    ? '滚动升级后，被替换的历史 Pod 会归入该分组。'
    : '切换左侧资源类型，或调整右上角的 Namespace 过滤。',
)

/* 应用内资源页签（对齐 Devtron：资源在 App Details 的页签里打开，而不是抽屉） */
const appTabScope = computed(() => `app:${appId.value}:${clusterId.value}`)
const resourceTabs = computed(() => (clusterId.value ? tabsStore.tabsOf(appTabScope.value) : []))
const activeTabId = computed(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = value ? String(value) : ''
  return id && resourceTabs.value.some((item) => item.id === id) ? id : ''
})
const activeAppTab = computed(() => resourceTabs.value.find((item) => item.id === activeTabId.value) ?? null)
const detailLocation = useResourceDetailLocation({
  scope: () => appTabScope.value,
  clusterId: () => clusterId.value,
  ready: () => !!clusterId.value && !bindLoading.value && !resLoading.value && !resError.value,
  kind: address => resources.value.find(item => item.ref.group === address.group && item.ref.resource === address.resource && item.ref.namespace === address.namespace && item.ref.name === address.name)?.kind,
})
const { refreshing: resourceRefreshing, syncedAt: resourceSyncedAt, synced: onResourceSynced, refresh: refreshResourceTab } = useResourceTabRefresh(() => resourcePanel.value, () => activeTabId.value)
watch([appTabScope, activeTabId], ([scope, id]) => { if (id || !route.query.tab) tabsStore.activate(scope, id) }, { immediate: true })

watch([resLoading, analyzerAvailable], ([loading, available]) => {
  if (!loading && !available && appView.value === 'analyzer') setAppView('resources')
})

const clusterLink = computed<RouteLocationRaw>(() => ({
  name: 'cluster-workspace',
  params: { clusterId: clusterId.value },
  query: activeAppTab.value
    ? {
        open: [
          activeAppTab.value.group || CORE_GROUP,
          activeAppTab.value.resource,
          activeAppTab.value.namespace,
          activeAppTab.value.name,
        ].join(','),
        openTab: activeAppTab.value.tab,
        openContainer: activeAppTab.value.container,
      }
    : undefined,
}))

async function setActiveTab(id: string): Promise<void> {
  if ((id === String(route.query.tab ?? '') && appView.value === 'resources') || !(await canLeavePanel())) return
  const query = detailLocation.queryFor(id)
  delete query.view
  if (id) query.tab = id
  else delete query.tab
  void router.replace({ query })
}

async function openAppTab(row: K8sResource, tab: ResourceTabKey = 'manifest', container?: string): Promise<void> {
  if (!(await canLeavePanel())) return
  const id = tabsStore.open({
    scope: appTabScope.value,
    clusterId: clusterId.value,
    group: row.ref.group,
    resource: row.ref.resource,
    namespace: row.ref.namespace,
    name: row.ref.name,
    kind: row.kind,
    tab,
    container,
  })
  setActiveTab(id)
}

async function closeAppTab(id: string, event?: Event): Promise<void> {
  event?.stopPropagation()
  const wasActive = id === activeTabId.value
  if (wasActive && !(await canLeavePanel())) return
  const previous = wasActive ? tabsStore.previous(appTabScope.value, id) : ''
  tabsStore.close(appTabScope.value, id)
  if (wasActive) await setActiveTab(previous)
}

async function resourceTabMenu(action: string, id: string): Promise<void> {
  if (action === 'refresh') { if (id === activeTabId.value) await refreshResourceTab(); else await setActiveTab(id); return }
  if ((action === 'all' || (action === 'others' && id !== activeTabId.value)) && !(await canLeavePanel())) return
  if (action === 'close') closeAppTab(id)
  if (action === 'others') { tabsStore.closeOthers(appTabScope.value, id); setActiveTab(id) }
  if (action === 'all') {
    resourceTabs.value.forEach((tab) => tabsStore.close(appTabScope.value, tab.id))
    setActiveTab('')
  }
}

function onContainerLogs(pod: K8sResource, container: string): void {
  openAppTab(pod, 'logs', container)
}

function onPanelTab(tab: ResourceTabKey): void {
  detailLocation.select(tab)
}

function envNameOf(environmentId: string): string {
  return environments.value.find((item) => item.id === environmentId)?.name ?? environmentId
}

function errorTextOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function goDeploy(): void {
  void router.push({ name: 'app-trigger', params: baseParams.value })
}

function openTerminal(): void {
  if (!clusterId.value) {
    MessagePlugin.warning('尚未选择环境，无法打开集群终端')
    return
  }
  void router.push({ name: 'cluster-terminal', params: { clusterId: clusterId.value } })
}

async function onDeleted(): Promise<void> {
  deleteTarget.value = null
  await loadResources()
}

function syncActiveResource(): void {
  const exists = kindTypes.value.some((item) => item.resource === activeResource.value && item.group === activeGroup.value)
  if (!exists) { activeResource.value = kindTypes.value[0]?.resource ?? ''; activeGroup.value = kindTypes.value[0]?.group ?? '' }
}

async function loadResources(): Promise<void> {
  if (!activeBindingId.value) {
    resources.value = []
    return
  }
  resLoading.value = true
  resError.value = ''
  try {
    resources.value = await listApplicationResources(appId.value, activeBindingId.value)
    syncActiveResource()
  } catch (err) {
    resources.value = []
    resError.value = errorTextOf(err, '运行资源加载失败')
  } finally {
    resLoading.value = false
  }
}

async function loadBindings(): Promise<void> {
  bindLoading.value = true
  bindError.value = ''
  try {
    const [bindingList, environmentList, appItem, deployPage, artifactItems, buildPage] = await Promise.all([
      listBindings(appId.value),
      listEnvironments(),
      getApplication(appId.value),
      listDeployments(appId.value),
      listArtifacts(appId.value),
      listBuilds(appId.value),
    ])
    bindings.value = bindingList
    environments.value = environmentList
    health.value = appItem.health
    appName.value = appItem.name
    deployments.value = deployPage.items
    artifacts.value = artifactItems
    builds.value = buildPage.items
    // 支持 ?env= 深链，刷新后保持同一环境上下文
    const fromQuery = String(route.query.env ?? '')
    const preferred = bindingList.find((item) => item.id === fromQuery) ?? bindingList[0]
    activeBindingId.value = preferred?.id ?? ''
    if (preferred) {
      void loadMonitoring()
      await loadResources()
    } else {
      resources.value = []
    }
  } catch (err) {
    bindError.value = errorTextOf(err, '环境绑定加载失败')
  } finally {
    bindLoading.value = false
  }
}

async function selectBinding(id: string): Promise<void> {
  if (id === activeBindingId.value || !(await canLeavePanel())) return
  activeBindingId.value = id
  activeResource.value = ''
  podTab.value = 'new'
  const query: LocationQuery = { ...resourceDetailQuery(route.query), env: id }
  delete query.tab
  delete query.view
  void router.replace({ query })
  void loadMonitoring()
  void loadResources()
}

function onBindingChange(value: SelectValue): void {
  selectBinding(String(value))
}

function selectKind(resource: string, group: string): void {
  activeResource.value = resource
  activeGroup.value = group
  podTab.value = 'new'
}

watch(
  appId,
  () => {
    activeBindingId.value = ''
    activeResource.value = ''
    resources.value = []
    void loadBindings()
  },
  { immediate: true },
)
</script>

<template>
  <div class="res">
    <div v-if="bindLoading" class="res__state">
      <t-loading size="small" />
      <span class="u-muted">加载环境绑定…</span>
    </div>
    <ErrorState v-else-if="bindError" :message="bindError" @retry="loadBindings" />

    <div v-else-if="!bindings.length" class="res__blank">
      <EmptyState
        title="尚未绑定环境"
        description="先在配置里创建工作流；绑定环境后，这里会展示应用运行资源。"
      >
        <template #action>
          <router-link :to="{ name: 'config-workflow', params: baseParams }">去创建工作流</router-link>
        </template>
      </EmptyState>
    </div>

    <template v-else>
      <!-- 环境条：ENV 胶囊 + 环境下拉 + 工具按钮 + Deploy -->
      <div class="res__envbar">
        <span class="tk-pill">环境</span>
        <t-select
          :value="activeBindingId"
          :options="envOptions"
          size="small"
          class="res__env-select"
          @change="onBindingChange"
        />
        <div class="res__envbar-actions">
          <div class="res__btns">
            <button type="button" class="res__icon-btn" title="复制页面链接" @click="copyPageLink">
              <t-icon name="link" size="15px" />
            </button>
            <button type="button" class="res__icon-btn" title="刷新" @click="refreshPage">
              <t-icon name="refresh" size="15px" />
            </button>
            <button type="button" class="res__icon-btn" title="对比环境" @click="compareVisible = true">
              <t-icon name="swap" size="15px" />
            </button>
          </div>
          <t-button size="small" variant="text" @click="notesVisible = true">Notes</t-button>
          <t-dropdown
            trigger="click"
            placement="bottom-right"
            :options="[
              { content: '重启工作负载', value: 'restart' },
              { content: hibernated ? '取消休眠' : '休眠', value: 'hibernate' },
              { content: '删除发布', value: 'delete-release', theme: 'error' },
            ]"
            @click="onEnvAction"
          >
            <button type="button" class="res__icon-btn" title="环境操作">
              <t-icon name="ellipsis" size="15px" />
            </button>
          </t-dropdown>
          <t-button theme="primary" size="small" class="res__deploy" @click="goDeploy">
            <template #icon><t-icon name="rocket" size="14px" /></template>
            部署
          </t-button>
        </div>
      </div>

      <div class="res__content">
        <!-- 两张状态卡 -->
        <div class="res__cards">
          <section class="tk-status-card res__card">
            <div class="res__card-head">
              <span class="tk-status-card__label">应用状态</span>
              <t-tooltip content="应用整体健康状态，由当前环境的运行资源汇总得出" placement="top">
                <t-icon name="info-circle" class="res__card-info" size="14px" />
              </t-tooltip>
              <t-icon
                name="heart-filled"
                class="res__card-mark"
                :class="`res__tone--${healthEntry.tone}`"
                size="22px"
              />
            </div>
            <span class="tk-status-card__value" :class="`res__tone--${healthEntry.tone}`">
              {{ healthEntry.label }}
            </span>
            <div class="res__card-foot">
              <button type="button" class="res__card-link" @click="healthVisible = true">详情</button>
            </div>
          </section>

          <section class="tk-status-card res__card">
            <div class="res__card-head">
              <span class="tk-status-card__label">部署状态</span>
              <t-tooltip content="当前环境下最近一次发布的状态" placement="top">
                <t-icon name="info-circle" class="res__card-info" size="14px" />
              </t-tooltip>
              <t-icon
                name="rocket"
                class="res__card-mark"
                :class="`res__tone--${deployState?.tone ?? 'default'}`"
                size="20px"
              />
            </div>
            <span class="tk-status-card__value" :class="`res__tone--${deployState?.tone ?? 'default'}`">
              {{ deployState?.label ?? '暂无发布' }}
            </span>
            <div class="res__card-foot">
              <span v-if="latestDeployment" class="u-dim">
                {{ fmtRelative(latestDeployment.createdAt) }} by {{ latestDeployment.operator }}
              </span>
              <span v-else class="u-dim">该环境还没有发布记录</span>
            </div>
          </section>

          <section class="tk-status-card res__card">
            <div class="res__card-head">
              <span class="tk-status-card__label">已部署提交</span>
              <t-tooltip content="当前环境已部署镜像对应的 Git 提交" placement="top">
                <t-icon name="info-circle" class="res__card-info" size="14px" />
              </t-tooltip>
              <svg class="res__card-mark" width="20" height="20" viewBox="0 0 48 48">
                <path
                  fill="#000a14"
                  d="M42.2,22.1L25.9,5.8C25.4,5.3,24.7,5,24,5c0,0,0,0,0,0c-0.7,0-1.4,0.3-1.9,0.8l-3.5,3.5l4.1,4.1c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3c0,0.5-0.1,0.9-0.3,1.3l4,4c0.4-0.2,0.8-0.3,1.3-0.3c1.7,0,3,1.3,3,3s-1.3,3-3,3c-1.7,0-3-1.3-3-3c0-0.5,0.1-0.9,0.3-1.3l-4-4c-0.1,0-0.2,0.1-0.3,0.1v10.4c1.2,0.4,2,1.5,2,2.8c0,1.7-1.3,3-3,3s-3-1.3-3-3c0-1.3,0.8-2.4,2-2.8V18.8c-1.2-0.4-2-1.5-2-2.8c0-0.5,0.1-0.9,0.3-1.3l-4.1-4.1L5.8,22.1C5.3,22.6,5,23.3,5,24c0,0.7,0.3,1.4,0.8,1.9l16.3,16.3c0,0,0,0,0,0c0.5,0.5,1.2,0.8,1.9,0.8s1.4-0.3,1.9-0.8l16.3-16.3c0.5-0.5,0.8-1.2,0.8-1.9C43,23.3,42.7,22.6,42.2,22.1z"
                />
              </svg>
            </div>
            <span v-if="deployedBuild" class="tk-status-card__value res__card-commit">
              <t-icon name="git-branch" size="14px" />
              {{ deployedBuild.commitSha.slice(0, 7) }}
            </span>
            <span v-else class="tk-status-card__value res__card-commit res__tone--default">—</span>
            <div class="res__card-foot res__card-foot--row">
              <template v-if="deployedBuild">
                <span class="res__card-pr" :title="deployedBuild.commitSubject">
                  {{ deployedBuild.commitSubject || '—' }}
                </span>
                <router-link class="res__card-link" :to="{ name: 'app-builds', params: baseParams }">详情</router-link>
              </template>
              <span v-else class="u-dim">该环境还没有发布记录</span>
            </div>
          </section>
        </div>

        <!-- MONITORING 区 -->
        <section class="res__monitoring tk-panel">
          <button type="button" class="res__monitor-head" @click="monitoringOpen = !monitoringOpen">
            <t-icon name="chart-bar" size="14px" />
            <span class="res__monitor-title">监控</span>
            <span class="res__monitor-hint">CPU / 内存 / 状态码 2xx·3xx·5xx / 吞吐 / 延迟</span>
            <span class="res__monitor-toggle">{{ monitoringOpen ? '收起' : '展开' }}</span>
          </button>
          <div v-if="monitoringOpen" class="res__monitor-body">
            <template v-if="monitoring">
              <div class="res__monitor-cell">
                <span class="res__monitor-label">CPU</span>
                <Sparkline :values="monitoring.cpu" unit="%" />
              </div>
              <div class="res__monitor-cell">
                <span class="res__monitor-label">内存</span>
                <Sparkline :values="monitoring.memory" unit="Mi" tone="success" />
              </div>
              <div class="res__monitor-cell">
                <span class="res__monitor-label">状态码</span>
                <span class="res__monitor-codes">
                  <em class="res__code res__code--ok">2xx {{ monitoring.status2xx }}</em>
                  <em class="res__code res__code--warn">3xx {{ monitoring.status3xx }}</em>
                  <em class="res__code res__code--bad">5xx {{ monitoring.status5xx }}</em>
                </span>
              </div>
              <div class="res__monitor-cell">
                <span class="res__monitor-label">吞吐</span>
                <Sparkline :values="monitoring.throughput" unit="/s" />
              </div>
              <div class="res__monitor-cell">
                <span class="res__monitor-label">延迟</span>
                <Sparkline :values="monitoring.latency" unit="ms" tone="warning" />
              </div>
            </template>
            <p v-else class="u-dim">该环境暂无监控数据。</p>
          </div>
        </section>

        <!-- K8s Resources 区域 -->
        <div class="res__panel">
          <div class="res__tabs">
            <ResourceWorkspaceTabs class="res__tabs-left" variant="application" :tabs="resourceTabs" :active="activeTabId" :refreshing="resourceRefreshing" :synced-at="resourceSyncedAt" @select="setActiveTab" @close="closeAppTab" @menu="resourceTabMenu" @refresh="refreshResourceTab">
              <template #fixed>
              <button
                type="button"
                class="res__tab"
                :class="{ 'res__tab--active': !activeAppTab && appView === 'resources' }"
                @click="setActiveTab('')"
              >
                <t-icon name="server" size="14px" />
                K8s 资源
              </button>
              <button
                v-if="analyzerAvailable"
                type="button"
                class="res__tab"
                :class="{ 'res__tab--active': !activeAppTab && appView === 'analyzer' }"
                @click="openAnalyzer"
              >
                <t-icon name="chart-bar" size="14px" />
                日志分析
              </button>
              </template>
            </ResourceWorkspaceTabs>
            <button
              v-if="!activeAppTab"
              type="button"
              class="res__icon-btn res__icon-btn--plain"
              :title="appView === 'analyzer' ? '重新连接分析器' : '刷新资源'"
              @click="appView === 'analyzer' ? analyzerRefreshKey++ : loadResources()"
            >
              <t-icon name="refresh" size="15px" />
            </button>
            <router-link v-else class="res__tabs-link" :to="clusterLink">在集群中查看</router-link>
          </div>

          <LogAnalyzerWorkspace
            v-if="analyzerAvailable"
            v-show="!activeAppTab && appView === 'analyzer'"
            :key="appTabScope"
            :resources="resources"
            :active="!activeAppTab && appView === 'analyzer' && !resLoading"
            :refresh-key="analyzerRefreshKey"
          />

          <ResourceDetailPanel
            ref="resourcePanel"
            manager="application"
            v-if="activeAppTab"
            :key="activeAppTab.id"
            :cluster-id="activeAppTab.clusterId"
            :group="activeAppTab.group"
            :resource="activeAppTab.resource"
            :namespace="activeAppTab.namespace"
            :name="activeAppTab.name"
            :tab="activeAppTab.tab"
            :initial-container="activeAppTab.container"
            :terminal-context="{ 应用: appName, 环境: activeBinding ? envNameOf(activeBinding.environmentId) : '—' }"
            @update:tab="onPanelTab"
            @update:container="detailLocation.container"
            @deleted="activeAppTab && closeAppTab(activeAppTab.id); loadResources()"
            @changed="loadResources()"
            @synced="onResourceSynced"
          />

          <div v-else-if="appView !== 'analyzer' || !analyzerAvailable" class="res__main">
            <K8sKindTree
              v-if="kindTypes.length"
              class="res__tree"
              :types="kindTypes"
              :active="activeResource"
              :active-group="activeGroup"
              :counts="kindCounts"
              @select="selectKind"
            />

            <div class="res__table-wrap">
              <div class="res__table-head">
                <div v-if="isPodKind" class="res__pods">
                  <button
                    type="button"
                    class="res__pod-tab"
                    :class="{ 'res__pod-tab--active': podTab === 'new' }"
                    @click="podTab = 'new'"
                  >
                    <span class="res__pod-title">新 Pod <em>{{ scopedRows.length }}</em></span>
                    <span class="res__pod-sub">{{ runningCount }} running</span>
                  </button>
                  <button
                    type="button"
                    class="res__pod-tab"
                    :class="{ 'res__pod-tab--active': podTab === 'old' }"
                    @click="podTab = 'old'"
                  >
                    <span class="res__pod-title">历史 Pod <em>0</em></span>
                    <span class="res__pod-sub">0 running</span>
                  </button>
                </div>
                <span v-else class="res__kind-hint">
                  <span class="res__kind-title">{{ activeKind }} <em>{{ rows.length }}</em></span>
                  <span class="res__kind-sub">{{ healthyRows }} healthy</span>
                </span>
              </div>

              <div v-if="resLoading" class="res__state">
                <t-loading size="small" />
                <span class="u-muted">加载运行资源…</span>
              </div>
              <ErrorState v-else-if="resError" :message="resError" @retry="loadResources" />
              <EmptyState
                v-else-if="!resources.length"
                title="该环境暂无应用资源"
                description="发布成功并同步后，Deployment、Pod、Service 等资源会出现在这里。"
              />
              <EmptyState v-else-if="!rows.length" compact :title="emptyTitle" :description="emptyDesc" />

                <ResourceHierarchy
                  v-else
                  :resources="resources"
                  :kind="activeResource"
                  :group="activeGroup"
                  @open="(resource: K8sResource, tab: ResourceTabKey) => openAppTab(resource, tab)"
                  @container="onContainerLogs"
                  @menu="onNodeMenu"
                />
            </div>
          </div>
        </div>
      </div>

      <!-- 底部上下文条 -->
      <div class="tk-context-bar res__context">
        <span>
          集群: <span class="res__context-value">{{ clusterId || '—' }}</span>
        </span>
        <span class="res__context-sep">|</span>
        <span>
          命名空间: <span class="res__context-value">{{ namespaceName || '—' }}</span>
        </span>
        <t-icon name="chevron-right" class="u-dim" size="12px" />
        <router-link
          class="res__context-link"
          :to="{ name: 'cluster-workspace', params: { clusterId } }"
        >
          <t-icon name="link" size="13px" />
          全部资源
        </router-link>
        <button type="button" class="res__context-link res__context-btn" @click="openTerminal">
          <t-icon name="close" size="13px" />
          集群终端
        </button>
      </div>
    </template>


    <t-dialog
      v-model:visible="workloadModalVisible"
      :header="workloadModal === 'restart' ? '重启工作负载' : hibernated ? '取消休眠' : '休眠'"
      width="560px"
      :footer="false"
    >
      <p class="u-dim res__dialog-text">
        {{
          workloadModal === 'restart'
            ? '所选工作负载的 Pod 会被重建；发布策略保持不变。'
            : hibernated
              ? '所选工作负载将恢复为配置的副本数。'
              : '所选工作负载的副本数会缩到 0，可随时取消休眠恢复。'
        }}
      </p>
      <t-checkbox-group v-model="selectedWorkloads" class="res__workloads">
        <t-checkbox v-for="item in workloadOptions" :key="item.value" :value="item.value" :label="item.label" />
      </t-checkbox-group>
      <p v-if="!workloadOptions.length" class="u-dim">当前环境没有可操作的工作负载。</p>
      <div class="res__dialog-actions">
        <t-button variant="text" @click="workloadModal = null">取消</t-button>
        <t-button theme="primary" :loading="workloadSaving" :disabled="!workloadOptions.length" @click="submitWorkloads">
          确认
        </t-button>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="releaseDeleteVisible"
      header="删除发布"
      theme="warning"
      width="480px"
      :footer="false"
    >
      <p class="res__dialog-text">
        将删除当前环境（{{ activeBinding ? envNameOf(activeBinding.environmentId) : '—' }}）的 release，
        应用本身与其它环境不受影响。此操作在真实集群中不可撤销。
      </p>
      <p class="u-dim">请输入应用名称 <span class="u-mono">{{ appName }}</span> 以确认：</p>
      <t-input v-model="releaseDeleteConfirm" placeholder="输入应用名称" />
      <div class="res__dialog-actions">
        <t-button variant="text" @click="releaseDeleteVisible = false">取消</t-button>
        <t-button theme="danger" :loading="releaseDeleting" @click="confirmReleaseDelete">删除 release</t-button>
      </div>
    </t-dialog>

    <t-dialog v-model:visible="vulnVisible" header="Check vulnerabilities" width="620px" :footer="false">
      <div v-if="vulnLoading" class="res__state"><t-loading size="small" /><span class="u-muted">扫描镜像…</span></div>
      <template v-else-if="vulnResult">
        <p class="u-dim res__dialog-text">
          镜像 <span class="u-mono">{{ vulnResult.imageRef }}</span>
        </p>
        <div class="res__vuln-codes">
          <span class="res__code res__code--bad">CRITICAL {{ vulnResult.critical }}</span>
          <span class="res__code res__code--bad">HIGH {{ vulnResult.high }}</span>
          <span class="res__code res__code--warn">MEDIUM {{ vulnResult.medium }}</span>
          <span class="res__code res__code--ok">LOW {{ vulnResult.low }}</span>
        </div>
        <t-table
          row-key="id"
          size="small"
          :data="vulnResult.items"
          :columns="[
            { colKey: 'id', title: 'CVE', width: 170 },
            { colKey: 'severity', title: '级别', width: 100 },
            { colKey: 'pkg', title: '组件' },
            { colKey: 'fixed', title: '修复版本', width: 110 },
          ]"
        >
          <template #id="{ row }"><span class="u-mono">{{ row.id }}</span></template>
          <template #severity="{ row }">
            <t-tag :theme="row.severity === 'LOW' ? 'warning' : 'danger'" variant="light" size="small">
              {{ row.severity }}
            </t-tag>
          </template>
        </t-table>
      </template>
      <div class="res__dialog-actions">
        <t-button variant="text" @click="vulnVisible = false">关闭</t-button>
      </div>
    </t-dialog>

    <ResourceActionDialog v-model:visible="deleteVisible" :cluster-id="clusterId" :targets="deleteTarget ? [deleteTarget] : []" action="delete" @completed="onDeleted" />

    <t-dialog
      v-model:visible="compareVisible"
      header="环境对比"
      width="880px"
      :footer="false"
    >
      <p class="u-dim res__dialog-text">按环境绑定对比集群、命名空间与最近一次发布的镜像 / 配置版本。</p>
      <t-table
        row-key="id"
        size="small"
        :data="compareRows"
        :columns="[
          { colKey: 'envName', title: '环境', width: 150 },
          { colKey: 'clusterId', title: '集群', width: 110 },
          { colKey: 'namespace', title: '命名空间', width: 130 },
          { colKey: 'imageRef', title: '镜像' },
          { colKey: 'configVersion', title: '配置版本', width: 100 },
          { colKey: 'status', title: '状态', width: 100 },
        ]"
      >
        <template #envName="{ row }">
          <span>{{ row.envName }}</span>
          <t-tag v-if="row.production" size="small" variant="outline" theme="warning">生产</t-tag>
        </template>
        <template #clusterId="{ row }"><span class="u-mono">{{ row.clusterId }}</span></template>
        <template #namespace="{ row }"><span class="u-mono">{{ row.namespace }}</span></template>
        <template #imageRef="{ row }"><span class="u-mono">{{ row.imageRef }}</span></template>
        <template #empty>
          <EmptyState title="还没有环境绑定" description="先在应用配置里绑定环境后再对比。" compact icon="layers" />
        </template>
      </t-table>
      <div class="res__dialog-actions">
        <t-button size="small" variant="text" @click="compareVisible = false">关闭</t-button>
      </div>
    </t-dialog>

    <t-drawer v-model:visible="healthVisible" size="820px" placement="right" :footer="false">
      <template #header>
        <div class="res__status-head">
          <span class="res__status-title">
            {{ appName }} / {{ activeBinding ? envNameOf(activeBinding.environmentId) : '—' }}
          </span>
          <button type="button" class="res__status-close" title="关闭" @click="healthVisible = false">
            <t-icon name="close" size="16px" />
          </button>
        </div>
      </template>

      <div class="res__status">
        <div class="res__status-tabs">
          <button
            type="button"
            class="res__status-tab"
            :class="{ 'res__status-tab--active': healthTab === 'app' }"
            @click="healthTab = 'app'"
          >
            <t-icon name="check-circle" size="14px" />
            应用状态
          </button>
          <button
            type="button"
            class="res__status-tab"
            :class="{ 'res__status-tab--active': healthTab === 'deploy' }"
            @click="healthTab = 'deploy'"
          >
            <t-icon name="check-circle" size="14px" />
            部署状态
          </button>
        </div>

        <template v-if="healthTab === 'app'">
          <div class="res__status-card">
            <span class="res__status-label">应用状态</span>
            <span class="res__status-value" :class="`res__status-value--${health}`">
              <t-icon :name="health === 'healthy' ? 'heart' : 'error-circle'" size="15px" />
              {{ healthEntry.label }}
            </span>
          </div>

          <div class="res__status-filters">
            <button
              type="button"
              class="res__status-chip"
              :class="{ 'res__status-chip--active': healthFilter === 'all' }"
              @click="healthFilter = 'all'"
            >
              全部 ({{ healthRows.length }})
            </button>
            <button
              type="button"
              class="res__status-chip"
              :class="{ 'res__status-chip--active': healthFilter === 'healthy' }"
              @click="healthFilter = 'healthy'"
            >
              <t-icon name="heart" size="13px" />
              {{ healthyCount }}
            </button>
            <button
              v-if="unhealthyCount"
              type="button"
              class="res__status-chip res__status-chip--bad"
              :class="{ 'res__status-chip--active': healthFilter === 'unhealthy' }"
              @click="healthFilter = 'unhealthy'"
            >
              <t-icon name="error-circle" size="13px" />
              {{ unhealthyCount }}
            </button>
          </div>

          <t-table
            row-key="id"
            size="small"
            :data="visibleHealthRows"
            :columns="[
              { colKey: 'kind', title: 'KIND', width: 150 },
              { colKey: 'name', title: 'NAME' },
              { colKey: 'status', title: 'STATUS', width: 150 },
              { colKey: 'message', title: 'MESSAGE', width: 220 },
            ]"
          >
            <template #kind="{ row }"><span class="u-mono">{{ row.kind }}</span></template>
            <template #name="{ row }"><span class="u-mono">{{ row.name }}</span></template>
            <template #status="{ row }">
              <span class="res__status-tag" :class="row.healthy ? 'res__status-tag--ok' : 'res__status-tag--bad'">
                <t-icon :name="row.healthy ? 'check-circle' : 'error-circle'" size="13px" />
                {{ row.status }}
              </span>
            </template>
            <template #message="{ row }"><span class="u-muted">{{ row.message || '—' }}</span></template>
            <template #empty>
              <EmptyState title="没有匹配的资源" description="切换筛选或刷新后重试。" compact icon="layers" />
            </template>
          </t-table>
        </template>

        <template v-else>
          <div class="res__status-card res__status-card--deploy">
            <span class="res__status-label">部署状态</span>
            <span v-if="latestDeployment" class="res__status-value">
              <StatusTag kind="deploy" :value="latestDeployment.status" />
            </span>
            <span v-else class="u-dim">当前环境还没有发布记录</span>
            <span v-if="latestDeployment" class="res__status-meta">
              {{ fmtRelative(latestDeployment.createdAt) }} by {{ latestDeployment.operator }}
            </span>
          </div>

          <template v-if="latestDeployment">
            <section class="res__status-section">
              <p class="res__status-section-title">Helm 详情</p>
              <dl class="tk-kv res__status-detail">
                <dt>releaseName</dt>
                <dd class="u-mono">{{ activeBinding?.target.releaseName ?? '—' }}</dd>
                <dt>命名空间</dt>
                <dd class="u-mono">{{ activeBinding?.target.namespace ?? '—' }}</dd>
                <dt>Helm revision</dt>
                <dd>{{ latestDeployment.helmRevision ?? '—' }}</dd>
                <dt>发布策略</dt>
                <dd>{{ strategyLabel(latestDeployment.strategy) }}</dd>
                <dt>配置版本</dt>
                <dd>v{{ latestDeployment.configVersion }}</dd>
              </dl>
            </section>

            <section class="res__status-section">
              <p class="res__status-section-title">本次发布</p>
              <dl class="tk-kv res__status-detail">
                <dt>镜像</dt>
                <dd class="u-mono">{{ latestDeployment.imageRef }}</dd>
                <dt>操作人</dt>
                <dd>{{ latestDeployment.operator }}</dd>
                <dt>时间</dt>
                <dd>{{ fmtRelative(latestDeployment.createdAt) }}</dd>
                <dt>原因</dt>
                <dd>{{ latestDeployment.reason || '—' }}</dd>
              </dl>
            </section>

            <section class="res__status-section">
              <div class="res__status-section-head">
                <p class="res__status-section-title">发布历史</p>
                <router-link class="res__status-link" :to="{ name: 'app-deployments', params: baseParams }">
                  查看全部
                </router-link>
              </div>
              <t-table
                row-key="id"
                size="small"
                :data="bindingDeployments"
                :columns="[
                  { colKey: 'helmRevision', title: 'REVISION', width: 100 },
                  { colKey: 'status', title: '状态', width: 120 },
                  { colKey: 'imageRef', title: '镜像' },
                  { colKey: 'createdAt', title: '时间', width: 110 },
                  { colKey: 'operator', title: '操作人', width: 100 },
                ]"
              >
                <template #helmRevision="{ row }">{{ row.helmRevision ?? '—' }}</template>
                <template #status="{ row }"><StatusTag kind="deploy" :value="row.status" /></template>
                <template #imageRef="{ row }"><span class="u-mono">{{ row.imageRef }}</span></template>
                <template #createdAt="{ row }">{{ fmtRelative(row.createdAt) }}</template>
                <template #empty>
                  <EmptyState title="还没有发布记录" description="在构建发布里选择镜像并发布。" compact icon="history" />
                </template>
              </t-table>
            </section>
          </template>

          <div class="res__status-filters">
            <span class="res__status-hint">
              环境内 Pod：运行 {{ healthRows.filter((row) => row.kind === 'Pod' && row.healthy).length }} / 共
              {{ healthRows.filter((row) => row.kind === 'Pod').length }}
            </span>
          </div>
        </template>
      </div>
    </t-drawer>
  </div>
  <ReleaseNotesDrawer v-model:visible="notesVisible" :app-id="appId" :binding-id="activeBindingId" />
</template>

<style scoped>
.res {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 130px);
  margin: -12px -16px -24px;
  background: var(--tk-bg);
}
.res__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
}
.res__blank {
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}

/* ---- 环境条 ---- */
.res__envbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.res__env-select {
  width: 180px;
}
.res__envbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.res__btns {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--tk-border-strong);
  border-radius: var(--tk-radius);
}
.res__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 26px;
  color: var(--tk-text-2);
  background: var(--tk-surface);
  border: 0;
  cursor: pointer;
}
.res__icon-btn + .res__icon-btn {
  border-left: 1px solid var(--tk-border);
}
.res__icon-btn:hover {
  color: var(--tk-primary);
  background: #f7f9fc;
}
.res__icon-btn--plain {
  width: 30px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--tk-radius);
}
.res__deploy {
  min-width: 96px;
}

.res__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* ---- 状态卡 ---- */
.res__monitoring {
  margin-bottom: 12px;
}
.res__monitor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 12px;
  font: inherit;
  color: var(--tk-primary);
  background: #eef4fd;
  border: 0;
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.res__monitor-title {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.res__monitor-hint {
  color: var(--tk-text-2);
  font-size: 12px;
}
.res__monitor-toggle {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.res__monitor-body {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  padding: 10px 12px;
  margin-top: 6px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.res__monitor-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.res__monitor-label {
  color: var(--tk-text-2);
  font-size: 11px;
}
.res__monitor-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.res__code {
  padding: 2px 6px;
  font-style: normal;
  font-size: 11px;
  border-radius: 3px;
}
.res__code--ok {
  color: #1f8f5f;
  background: #e8f8f0;
}
.res__code--warn {
  color: #a86800;
  background: #fff4e5;
}
.res__code--bad {
  color: #c33028;
  background: #fdeceb;
}
.res__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
}
.res__card {
  width: 322px;
  gap: 4px;
}
.res__card-head {
  display: flex;
  align-items: center;
  gap: 5px;
}
.res__card-info {
  color: var(--tk-text-3);
}
.res__card-mark {
  margin-left: auto;
}
.res__card-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--tk-border);
  font-size: 12px;
}
.res__card-link {
  padding: 0;
  font: inherit;
  color: var(--tk-primary);
  background: none;
  border: 0;
  cursor: pointer;
}
.res__card-link:hover {
  text-decoration: underline;
}
.res__card-foot--row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.res__card-commit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--tk-mono);
}
.res__card-pr {
  overflow: hidden;
  max-width: 232px;
  color: #3b444c;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.res__tone--success {
  color: var(--tk-success);
}
.res__tone--danger {
  color: var(--tk-danger);
}
.res__tone--warning {
  color: var(--tk-warning);
}
.res__tone--info {
  color: var(--tk-primary);
}
.res__tone--default {
  color: var(--tk-text-2);
}
.res__tone--primary {
  color: var(--tk-primary);
}

/* ---- K8s Resources 面板 ---- */
.res__panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--tk-surface);
  border-top: 1px solid var(--tk-border);
}
.res__tabs {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--tk-border);
}
.res__tabs-left {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 8px;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}
.res__tab--resource {
  max-width: 240px;
}
.res__tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.res__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--tk-text-3);
  border-radius: 3px;
}
.res__tab-close:hover {
  color: var(--tk-danger);
  background: #fdeceb;
}
.res__tabs-link {
  flex: none;
  padding-left: 12px;
  margin-left: auto;
  color: var(--tk-primary);
  font-size: 12px;
}
.res__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0;
  color: var(--tk-text-2);
  font: inherit;
  font-size: 13px;
  background: none;
  border: 0;
  cursor: pointer;
}
.res__tab:hover {
  color: var(--tk-primary);
}
.res__tab--active {
  color: var(--tk-text);
  font-weight: 600;
}
.res__tab--active::after {
  content: '';
  position: absolute;
  right: -8px;
  bottom: -1px;
  left: -8px;
  height: 2px;
  background: var(--tk-primary);
}
.res__tabs > .res__icon-btn {
  margin-left: auto;
}
.res__main {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}
.res__tree {
  width: 232px;
  flex: none;
  padding: 8px 4px;
  overflow: auto;
  background: var(--tk-surface);
  border: 0;
  border-right: 1px solid var(--tk-border);
  border-radius: 0;
  box-shadow: none;
}
.res__table-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding-bottom: 8px;
}

/* ---- Pod 子页签 + Namespace 过滤 ---- */
.res__table-head {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--tk-border);
}
.res__pods {
  display: flex;
  align-items: flex-end;
  gap: 28px;
}
.res__pod-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 2px 9px;
  color: var(--tk-text-2);
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
.res__pod-title {
  font-size: 13px;
  font-weight: 600;
}
.res__pod-title em {
  margin-left: 4px;
  color: var(--tk-text-3);
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
}
.res__pod-sub {
  color: var(--tk-text-3);
  font-size: 11px;
}
.res__pod-tab--active {
  color: var(--tk-text);
}
.res__pod-tab--active::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--tk-primary);
}
.res__pod-tab--active .res__pod-sub {
  color: var(--tk-text-2);
}
.res__kind-hint {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 10px;
  color: var(--tk-text-3);
  font-size: 12px;
}
.res__kind-title {
  color: var(--tk-text);
  font-weight: 600;
}
.res__kind-title em {
  margin-left: 6px;
  padding: 0 6px;
  font-style: normal;
  font-size: 11px;
  background: #eef2f9;
  border-radius: 8px;
}
.res__kind-sub {
  font-size: 11px;
}
.res__ns {
  width: 190px;
  margin-bottom: 10px;
  margin-left: auto;
}

/* ---- 资源表 ---- */
.res-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.res-table th {
  height: 38px;
  padding: 0 16px;
  color: var(--tk-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  border-bottom: 1px solid var(--tk-border);
}
.res-table th.res-table__metric {
  width: 104px;
}
.res-table th.res-table__op {
  width: 48px;
}
.res-table td {
  padding: 9px 16px;
  font-size: 13px;
  vertical-align: middle;
  border-bottom: 1px solid var(--tk-border);
}
.res-table tbody tr:hover {
  background: #f7f9fc;
}
.res-table__metric {
  color: var(--tk-text);
}
.res-table__op {
  text-align: right;
}
.res-row__main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.res-row__caret {
  flex: none;
  color: var(--tk-text-3);
}
.res-row__name {
  overflow: hidden;
  padding: 0;
  color: var(--tk-primary);
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 0;
  cursor: pointer;
}
.res-row__name:hover {
  text-decoration: underline;
}
.res-row__mini,
.res-row__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 2px;
  color: var(--tk-text-3);
  background: none;
  border: 0;
  cursor: pointer;
}
.res-row__mini:hover,
.res-row__more:hover {
  color: var(--tk-primary);
}
.res-row__logs {
  flex: none;
  height: 20px;
  padding: 0 6px;
  color: var(--tk-text-2);
  font: inherit;
  font-size: 11px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border-strong);
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.res-row__logs:hover {
  color: var(--tk-primary);
  border-color: var(--tk-primary);
}
.res-row__status {
  margin: 2px 0 0 22px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.res-row__status--success {
  color: var(--tk-success);
}
.res-row__status--warning {
  color: var(--tk-warning);
}
.res-row__status--danger {
  color: var(--tk-danger);
}
.res-row__status--default {
  color: var(--tk-text-3);
}

/* ---- 底部上下文条 ---- */
.res__context {
  /* 抵消 .shell__page 的 24px 底部内边距，让上下文条贴住视口底部（对齐 Devtron） */
  position: sticky;
  bottom: -24px;
  gap: 8px;
}
.res__context-value {
  color: var(--tk-text);
}
.res__context-sep {
  color: var(--tk-border-strong);
}
.res__context-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  color: var(--tk-text-2);
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.res__context-link:hover {
  color: var(--tk-primary);
  background: var(--tk-primary-weak);
}
.res__context-btn {
  margin-left: -2px;
}

/* ---- 抽屉 ---- */
.res-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.res-drawer__title {
  font-weight: 600;
}
.res-drawer__link {
  font-weight: 400;
}
.res-drawer__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.res-drawer__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.res-drawer__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.res-drawer__label {
  margin: 0;
  color: var(--tk-text-2);
  font-weight: 600;
}
.res-drawer__manifest {
  max-height: 320px;
}
.res-drawer__logs {
  max-height: 260px;
}
.res__dialog-text {
  margin: 0;
}
.res__status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.res__status-close {
  padding: 0;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  cursor: pointer;
  line-height: 0;
}
.res__status-title {
  font-size: 15px;
  font-weight: 600;
}
.res__status {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.res__status-tabs {
  display: flex;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--tk-border);
}
.res__status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0;
  font: inherit;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.res__status-tab--active {
  color: var(--tk-primary);
  font-weight: 600;
  border-bottom-color: var(--tk-primary);
}
.res__status-card {
  display: flex;
  align-items: center;
  gap: 48px;
  padding: 12px 16px;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  background: var(--tk-surface);
}
.res__status-card--deploy {
  gap: 48px;
}
.res__status-label {
  color: var(--tk-text-2);
}
.res__status-meta {
  color: var(--tk-text-2);
  font-size: 12px;
}
.res__status-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.res__status-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.res__status-section-title {
  margin: 0;
  color: var(--tk-text-2);
  font-weight: 600;
}
.res__status-link {
  color: var(--tk-primary);
  font-size: 12px;
}
.res__status-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.res__status-value--healthy {
  color: var(--tk-success);
}
.res__status-value--degraded {
  color: var(--tk-danger);
}
.res__status-value--progressing {
  color: var(--tk-warning);
}
.res__status-filters {
  display: flex;
  align-items: center;
  gap: 8px;
}
.res__status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  font: inherit;
  color: var(--tk-text-2);
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  cursor: pointer;
}
.res__status-chip--active {
  color: var(--tk-primary);
  border-color: #b9d0f5;
  background: #eef4fd;
  font-weight: 600;
}
.res__status-chip--bad {
  color: var(--tk-danger);
}
.res__status-hint {
  color: var(--tk-text-2);
  font-size: 12px;
}
.res__status-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.res__status-tag--ok {
  color: var(--tk-success);
}
.res__status-tag--bad {
  color: var(--tk-danger);
}
.res__status-detail {
  padding: 12px 16px;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.res__workloads {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 10px 0;
}
.res__vuln-codes {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.res__dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
.res__dialog-list {
  margin-top: 10px;
}
.res__dialog-label {
  margin: 12px 0 4px;
  color: var(--tk-text-2);
  font-weight: 600;
}
</style>
