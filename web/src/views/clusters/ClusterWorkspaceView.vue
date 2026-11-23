<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQuery } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import {
  discoverResources,
  getCluster,
  getClusterOverview,
  getResource,
  getNodeDetail,
  listClusters,
  listClusterEvents,
  listNamespace,
  listResources,
} from '@/api'
import type { ClusterEventRow } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import K8sKindTree from '@/components/K8sKindTree.vue'
import ResourceDetailPanel from '@/components/resource/ResourceDetailPanel.vue'
import ResourceWorkspaceTabs from '@/components/resource/ResourceWorkspaceTabs.vue'
import ResourceListTable from '@/components/resource/ResourceListTable.vue'
import ResourceEventsTable from '@/components/resource/ResourceEventsTable.vue'
import ResourceActionDialog from '@/components/resource/ResourceActionDialog.vue'
import ResourceCreateDrawer from '@/components/resource/ResourceCreateDrawer.vue'
import NodeListFilters from '@/components/resource/NodeListFilters.vue'
import ResourceColumnSelector from '@/components/resource/ResourceColumnSelector.vue'
import { useNodeListFilters } from '@/composables/useNodeListFilters'
import { useResourceListState } from '@/composables/useResourceListState'
import { useResourceTabRefresh } from '@/composables/useResourceTabRefresh'
import { useResourceDetailLocation } from '@/composables/useResourceDetailLocation'
import { resourceDetailQuery } from '@/utils/resourceDetailLocation'
import { matchesNodeFilters, nodeFilterData, nodeFilterOptions, queryText } from '@/utils/resourceFilters'
import type { ResourceRow, ResourceAction } from '@/components/resource/listTypes'
import { useResourceTabsStore } from '@/stores/resourceTabs'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import ClusterOverviewPanel from '@/components/cluster/ClusterOverviewPanel.vue'
import type { Cluster, ClusterOverview, ConnectionStatus, K8sResource, Namespace, NodeDetail, ResourceType } from '@/types'
import { normalizeResourceGroup, resolveResourceType, resourceColumns, resourceListRow } from '@/utils/resourceListing'

const connectionLabels: Record<ConnectionStatus, string> = {
  connected: '已连接',
  unavailable: '连接不可用',
  unknown: '未检测',
}

const connectionTones: Record<ConnectionStatus, 'ok' | 'bad' | 'idle'> = {
  connected: 'ok',
  unavailable: 'bad',
  unknown: 'idle',
}

/** Nodes / Namespaces / Events 不放进分类树，用工作区页签单独进入 */
const TREE_EXCLUDED = ['nodes', 'namespaces', 'events']

const route = useRoute()
const router = useRouter()
const { filters: nodeFilters, search: nodeSearch, update: updateNodeFilter, clear: clearNodeFilters } = useNodeListFilters()
const tabsStore = useResourceTabsStore()
const resourcePanel = useTemplateRef<InstanceType<typeof ResourceDetailPanel>>('resourcePanel')
async function canLeavePanel(): Promise<boolean> { return await (resourcePanel.value?.requestLeave() ?? true) }

const cluster = ref<Cluster | null>(null)
const types = ref<ResourceType[]>([])
const namespaces = ref<Namespace[]>([])
const resources = ref<K8sResource[]>([])
const clusterEvents = ref<ClusterEventRow[]>([])
const nodeDetails = ref<Record<string, NodeDetail>>({})
const overview = ref<ClusterOverview | null>(null)

/* 创建资源（P1：多文档 YAML → Dry run → Apply） */
// 上述为原 P1 流程；创建抽屉现按参考实现直接应用并保留逐项结果页。
const createVisible = ref(false)
const createTrigger = useTemplateRef<{ $el: HTMLButtonElement }>('createTrigger')
const eventsLoading = ref(false)
const eventsError = ref('')
const defaultResource = ref('')
const loading = ref(false)
const tableLoading = ref(false)
const error = ref('')
const listError = ref('')
const keyword = computed({ get: () => queryText(route.query.searchKey), set: value => listState.filter('searchKey', value) })
const namespace = computed({ get: () => queryText(route.query.namespace) || 'all', set: value => listState.filter('namespace', value === 'all' ? '' : value) })
const clusterList = ref<Cluster[]>([])
const actionVisible = ref(false)
const actionType = ref<ResourceAction>('delete')
const actionTargets = ref<K8sResource[]>([])
const eventType = computed({ get: () => queryText(route.query.eventType).toLowerCase() === 'normal' ? 'normal' : 'warning', set: value => listState.filter('eventType', value === 'normal' ? 'normal' : '') })
const loadedListContext = ref('')
const loadedEventsCluster = ref('')
let listRequest = 0
let shellRequest = 0
let eventRequest = 0

async function openAction(action: string, selected: ResourceRow[]): Promise<void> {
  const context = `${clusterId.value}/${activeType.value?.group}/${activeResource.value}`
  try {
    const targets = await Promise.all(selected.map((row) => getResource(clusterId.value, row.group, activeResource.value, row.namespace, row.name)))
    if (context !== `${clusterId.value}/${activeType.value?.group}/${activeResource.value}`) return
    actionTargets.value = targets
    actionType.value = action as ResourceAction
    actionVisible.value = true
  } catch (err) { void MessagePlugin.error(err instanceof Error ? err.message : '资源加载失败') }
}
async function onActionCompleted(deleted: string[]): Promise<void> {
  for (const target of actionTargets.value.filter((item) => deleted.includes(item.ref.uid))) {
    const tab = clusterTabs.value.find((item) => item.group === target.ref.group && item.resource === target.ref.resource && item.name === target.ref.name && item.namespace === target.ref.namespace)
    if (tab) closeTab(tab.id)
  }
  await loadShell()
  await loadResources()
}
async function switchCluster(value: unknown): Promise<void> {
  if (typeof value !== 'string' || value === clusterId.value || !(await canLeavePanel())) return
  tabsStore.clearCluster(clusterId.value)
  void router.push({ name: 'cluster-workspace', params: { clusterId: value } })
}
async function tabMenu(value: string, id: string): Promise<void> {
  if (value === 'refresh') { if (id === activeTabId.value) await refreshResourceTab(); else await setActiveTab(id); return }
  if ((value === 'all' || (value === 'others' && id !== activeTabId.value)) && !(await canLeavePanel())) return
  if (value === 'close') closeTab(id)
  else if (value === 'others') { tabsStore.closeOthers(clusterId.value, id); setActiveTab(id) }
  else { for (const tab of [...clusterTabs.value]) tabsStore.close(clusterId.value, tab.id); setActiveTab('') }
}

/** 不同 Kind 用不同的列（对齐 Devtron Resource Browser） */
const columns = computed(() => resourceColumns(activeType.value))

const clusterId = computed(() => String(route.params.clusterId ?? ''))

/** 老深链里的 view=nodes|events|namespaces 仍然映射成对应资源类型 */
const legacyView = computed(() => {
  const raw = route.query.view
  const value = Array.isArray(raw) ? raw[0] : raw
  return value ? String(value) : ''
})

const requestedResource = computed(() => {
  const raw = route.query.resource
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value) return String(value)
  if (['nodes', 'events', 'namespaces'].includes(legacyView.value)) return legacyView.value
  return ''
})

/** 工作区视图：概览 / 资源类型列表（Nodes、Events、Namespaces 也是资源类型页签） */
const currentView = computed<'overview' | 'list'>(() => {
  if (legacyView.value === 'overview') return 'overview'
  // 只要带了具体资源类型（含老深链 view=nodes 等）就落在列表视图
  return requestedResource.value ? 'list' : 'overview'
})

const KIND_LABELS: Record<string, string> = {
  nodes: 'Node',
  events: 'Event',
  namespaces: 'Namespace',
}

/** 顶部固定的三个“非分类”资源类型（与 Devtron 左侧一致） */
const PINNED_KINDS = [
  { value: 'nodes', label: 'Nodes' },
  { value: 'events', label: 'Events' },
  { value: 'namespaces', label: 'Namespaces' },
]
const pinnedKinds = computed(() => PINNED_KINDS.flatMap(item => {
  const type = types.value.find(type => type.resource === item.value && !type.group)
  return type ? [{ ...item, shortNames: type.shortNames }] : []
}))

const treeTypes = computed(() => types.value.filter((item) => item.group || !TREE_EXCLUDED.includes(item.resource)))

const activeResource = computed(() => requestedResource.value || defaultResource.value)
const requestedGroup = computed(() => route.query.group === undefined ? undefined : normalizeResourceGroup(route.query.group))
const activeType = computed(() => resolveResourceType(types.value, activeResource.value, requestedGroup.value) ?? null)
const isEvents = computed(() => activeType.value?.resource === 'events' && activeType.value.group === '')
const isNodes = computed(() => activeType.value?.resource === 'nodes' && activeType.value.group === '')
const nodeData = computed(() => resources.value.map(item => nodeFilterData(item, nodeDetails.value[item.ref.name])))
const nodeOptions = computed(() => nodeFilterOptions(nodeData.value))
const currentKind = computed(
  () => (!activeType.value?.group ? KIND_LABELS[activeResource.value] : undefined) ?? activeType.value?.kind ?? activeResource.value,
)

const connectionStatus = computed<ConnectionStatus>(() => cluster.value?.connectionStatus ?? 'unknown')
const connectionLabel = computed(() => connectionLabels[connectionStatus.value])
const connectionTone = computed(() => connectionTones[connectionStatus.value])

const namespaceOptions = computed(() => [
  { label: '全部命名空间', value: 'all' },
  ...namespaces.value.map((item) => ({ label: item.name, value: item.name })),
])

/** 从 summary / manifest 里抽取该 Kind 特有的列值：由 resourceListRow 结构化解析。 */
const rows = computed<ResourceRow[]>(() => {
  if (!activeType.value) return []
  if (activeType.value.resource === 'namespaces' && !activeType.value.group) {
    return namespaces.value.filter((item) => !keyword.value || item.name.toLowerCase().includes(keyword.value.trim().toLowerCase())).map((item) => ({
      id: item.uid,
      name: item.name,
      namespace: '_cluster',
      kind: 'Namespace',
      status: item.phase,
      age: '—',
      group: '',
      fields: {},
    }))
  }
  return resources.value.flatMap((item, index) => {
    if (isNodes.value && !matchesNodeFilters(nodeData.value[index]!, nodeFilters.value, nodeSearch.value)) return []
    const row = resourceListRow(item, activeType.value, nodeDetails.value[item.ref.name])
    if (isNodes.value) row.fields.nodeGroup = nodeData.value[index]?.nodeGroup || '—'
    if (!isNodes.value && keyword.value.trim() && !columns.value.some(column => {
      const value = column.key === 'name' ? row.name : column.key === 'namespace' ? row.namespace : column.key === 'status' ? row.status : column.key === 'age' ? row.age : row.fields[column.key]
      return value?.toLowerCase().includes(keyword.value.trim().toLowerCase())
    })) return []
    return [row]
  })
})

const eventRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return clusterEvents.value
    .filter((item) => {
      if (namespace.value !== 'all' && item.namespace !== namespace.value) return false
      if (item.type.toLowerCase() !== eventType.value) return false
      if (!kw) return true
      return (
        item.name.toLowerCase().includes(kw) || item.kind.toLowerCase().includes(kw) || item.namespace.toLowerCase().includes(kw) || item.type.toLowerCase().includes(kw) || String(item.count).includes(kw) ||
        item.reason.toLowerCase().includes(kw) ||
        item.message.toLowerCase().includes(kw)
      )
    })
    .map((item) => ({
      ...item,
      object: `${item.kind}/${item.name}`,
    }))
})

const clusterTabs = computed(() => tabsStore.tabsOf(clusterId.value))

const activeTabId = computed(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = value ? String(value) : ''
  return id && clusterTabs.value.some((item) => item.id === id) ? id : ''
})

const activeTab = computed(() => clusterTabs.value.find((item) => item.id === activeTabId.value) ?? null)
const detailLocation = useResourceDetailLocation({
  scope: () => clusterId.value,
  clusterId: () => clusterId.value,
  ready: () => !loading.value && cluster.value?.id === clusterId.value,
  kind: address => resolveResourceType(types.value, address.resource, address.group)?.kind,
})
const { refreshing: resourceRefreshing, syncedAt: resourceSyncedAt, synced: onResourceSynced, refresh: refreshResourceTab } = useResourceTabRefresh(() => resourcePanel.value, () => activeTabId.value)
watch([clusterId, activeTabId], ([scope, id]) => { if (id || !route.query.tab) tabsStore.activate(scope, id) }, { immediate: true })

const listContext = computed(() => JSON.stringify([clusterId.value, activeType.value?.group, activeResource.value, activeType.value?.namespaced ? namespace.value : 'all']))
const listReady = computed(() => currentView.value === 'list' && !loading.value && (isEvents.value ? !eventsLoading.value && !eventsError.value && loadedEventsCluster.value === clusterId.value : !tableLoading.value && !listError.value && loadedListContext.value === listContext.value))
const sortKeys = computed(() => isEvents.value ? ['namespace', 'object', 'type', 'reason', 'message', 'count', 'last seen'] : columns.value.filter(column => column.key !== 'ops').map(column => column.key))
const defaultSort = computed(() => isEvents.value ? 'last seen' : sortKeys.value.includes('namespace') ? 'namespace' : 'name')
const listTotal = computed(() => isEvents.value ? eventRows.value.length : rows.value.length)
const listState = useResourceListState(sortKeys, defaultSort, listTotal, listReady)
const { state: tableState } = listState
const selectionKey = computed(() => `${clusterId.value}/${JSON.stringify(route.query)}`)

function pickDefaultResource(resourceTypes: ResourceType[]): string {
  const candidates = resourceTypes.filter((item) => !TREE_EXCLUDED.includes(item.resource))
  if (candidates.some((item) => item.resource === 'deployments')) return 'deployments'
  return candidates[0]?.resource ?? ''
}

async function loadShell(): Promise<void> {
  if (!clusterId.value) return
  const request = ++shellRequest
  const targetCluster = clusterId.value
  loading.value = true
  error.value = ''
  try {
    const [clusterInfo, resourceTypes, namespaceList, allClusters] = await Promise.all([
      getCluster(targetCluster),
      discoverResources(targetCluster),
      listNamespace(targetCluster),
      listClusters(),
    ])
    if (request !== shellRequest || targetCluster !== clusterId.value) return
    cluster.value = clusterInfo
    clusterList.value = allClusters
    types.value = resourceTypes
    namespaces.value = namespaceList
    defaultResource.value = pickDefaultResource(resourceTypes)
  } catch (err) {
    if (request !== shellRequest || targetCluster !== clusterId.value) return
    cluster.value = null
    types.value = []
    namespaces.value = []
    error.value = err instanceof Error ? err.message : '集群工作区加载失败'
  } finally {
    if (request === shellRequest && targetCluster === clusterId.value) loading.value = false
  }
}

async function loadResources(): Promise<void> {
  const request = ++listRequest
  loadedListContext.value = ''
  tableLoading.value = true
  const targetCluster = clusterId.value
  const targetContext = listContext.value
  const resource = activeResource.value
  const type = activeType.value
  resources.value = []
  nodeDetails.value = {}
  listError.value = ''
  if (!clusterId.value || !resource) { tableLoading.value = false; return }
  if (!type) {
    listError.value = '当前 Discovery 中没有该 API group / 资源类型，请从左侧重新选择。'
    tableLoading.value = false
    return
  }
  if (resource === 'namespaces' && !type.group) {
    // Namespace 来自 shell 已加载的列表，不需要再查资源接口
    resources.value = []
    loadedListContext.value = targetContext
    tableLoading.value = false
    return
  }
  try {
    const result = await listResources(targetCluster, {
      group: type?.group ?? '',
      resource,
      namespace: !type?.namespaced || namespace.value === 'all' ? undefined : namespace.value,
    })
    const nodeResults = resource === 'nodes' && !type?.group ? await Promise.allSettled(result.map(item => getNodeDetail(targetCluster, item.ref.name))) : []
    const nodes = nodeResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    if (request === listRequest && targetCluster === clusterId.value && targetContext === listContext.value) {
      resources.value = result
      nodeDetails.value = Object.fromEntries(nodes.map(node => [node.name, node]))
      loadedListContext.value = targetContext
    }
  } catch (err) {
    if (request !== listRequest || targetCluster !== clusterId.value || targetContext !== listContext.value) return
    resources.value = []
    listError.value = err instanceof Error ? err.message : '资源列表加载失败'
  } finally {
    if (request === listRequest && targetCluster === clusterId.value && targetContext === listContext.value) tableLoading.value = false
  }
}

async function loadEvents(): Promise<void> {
  if (!clusterId.value) return
  const targetCluster = clusterId.value
  const request = ++eventRequest
  loadedEventsCluster.value = ''
  eventsLoading.value = true
  eventsError.value = ''
  try {
    const events = await listClusterEvents(targetCluster)
    if (clusterId.value !== targetCluster || request !== eventRequest) return
    clusterEvents.value = events
    loadedEventsCluster.value = targetCluster
  } catch (err) {
    if (clusterId.value !== targetCluster || request !== eventRequest) return
    clusterEvents.value = []
    eventsError.value = err instanceof Error ? err.message : '事件加载失败'
  } finally {
    if (clusterId.value === targetCluster && request === eventRequest) eventsLoading.value = false
  }
}

async function loadOverview(): Promise<void> {
  if (!clusterId.value) return
  const targetCluster = clusterId.value
  try {
    const result = await getClusterOverview(targetCluster)
    if (clusterId.value === targetCluster) overview.value = result
  } catch {
    if (clusterId.value === targetCluster) overview.value = null
  }
}

async function refreshAll(): Promise<void> {
  if (!(await canLeavePanel())) return
  const targetCluster = clusterId.value
  await loadShell()
  if (error.value || clusterId.value !== targetCluster) return
  if (currentView.value === 'overview') await loadOverview()
  else if (isEvents.value) await loadEvents()
  else await loadResources()
  await resourcePanel.value?.reload()
}

function selectKind(resource: string, group = ''): void {
  if (resource === activeResource.value && group === (activeType.value?.group ?? '') && currentView.value === 'list') return
  const query: LocationQuery = { ...resourceDetailQuery(route.query), resource, group: group || 'core' }
  delete query.view
  delete query.tab
  delete query.page
  delete query.pageNumber
  delete query.sortBy
  delete query.sortOrder
  if (resource !== 'events' || group) delete query.eventType
  void router.push({ query })
}

async function setActiveTab(id: string): Promise<void> {
  if (id === String(route.query.tab ?? "") || !(await canLeavePanel())) return
  const query = detailLocation.queryFor(id)
  if (id) query.tab = id
  else delete query.tab
  void router.replace({ query })
}

function setView(view: 'overview' | 'list'): void {
  const query = resourceDetailQuery(route.query)
  delete query.tab
  if (view === 'overview') {
    delete query.view
    delete query.resource
    delete query.group
  } else {
    delete query.view
    query.resource = activeResource.value || defaultResource.value
  }
  void router.replace({ query })
}

async function openResourceTab(row: ResourceRow, tab: ResourceTabKey = 'manifest'): Promise<void> {
  if (!(await canLeavePanel())) return
  if (activeResource.value === 'nodes' && !row.group) {
    void router.push({
      name: 'node-detail',
      params: { clusterId: clusterId.value, nodeName: row.name, tab: 'summary' },
    })
    return
  }
  const id = tabsStore.open({
    clusterId: clusterId.value,
    group: row.group,
    resource: activeResource.value,
    namespace: row.namespace,
    name: row.name,
    kind: row.kind,
    tab,
  })
  setActiveTab(id)
}

async function closeTab(id: string, event?: Event): Promise<void> {
  event?.stopPropagation()
  const wasActive = id === activeTabId.value
  if (wasActive && !(await canLeavePanel())) return
  const previous = wasActive ? tabsStore.previous(clusterId.value, id) : ''
  tabsStore.close(clusterId.value, id)
  if (wasActive) await setActiveTab(previous)
}

function onPanelTab(tab: ResourceTabKey): void {
  detailLocation.select(tab)
}

function openNode(name: string): void {
  void router.push({ name: 'node-detail', params: { clusterId: clusterId.value, nodeName: name, tab: 'summary' } })
}

function openTerminal(): void {
  void router.push({ name: 'cluster-terminal', params: { clusterId: clusterId.value } })
}

function createResource(): void { createVisible.value = true }

async function onCreateClosed(refresh: boolean): Promise<void> {
  createVisible.value = false
  await nextTick(); createTrigger.value?.$el.focus({ preventScroll: true })
  if (!refresh) return
  const target = clusterId.value
  await loadResources()
  try { const updated = await listNamespace(target); if (clusterId.value === target) namespaces.value = updated }
  catch { /* Resource list errors are handled by loadResources; namespace options refresh on the next shell load. */ }
}

function consumeOpenQuery(): void {
  const raw = route.query.open
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return
  const [group = '', resource = '', namespace = '', name = ''] = String(value).split(',')
  if (!resource || !name) return
  const kind = resolveResourceType(types.value, resource, normalizeResourceGroup(group))?.kind ?? resource
  const requestedTab = String(route.query.openTab ?? 'manifest')
  const requestedContainer = typeof route.query.openContainer === 'string' ? route.query.openContainer : undefined
  const id = tabsStore.open({
    clusterId: clusterId.value,
    group: group === 'core' || group === '_' ? '' : group,
    resource,
    namespace,
    name,
    kind,
    tab: (['manifest', 'events', ...(resource === 'pods' ? ['logs', 'terminal'] : [])].includes(requestedTab) ? requestedTab : 'manifest') as ResourceTabKey,
    container: requestedContainer,
  })
  const query: LocationQuery = { ...resourceDetailQuery(route.query, tabsStore.tabsOf(clusterId.value).find(item => item.id === id)), tab: id }
  delete query.open
  delete query.openTab
  delete query.openContainer
  delete query.view
  void router.replace({ query })
}

watch(() => route.query.open, () => {
  if (!loading.value && cluster.value?.id === clusterId.value) consumeOpenQuery()
})

watch(
  clusterId,
  () => {
    void (async () => {
      await refreshAll()
      consumeOpenQuery()
    })()
  },
  { immediate: true },
)

watch([requestedResource, requestedGroup, legacyView], () => {
  if (currentView.value === 'overview') {
    void loadOverview()
    return
  }
  if (isEvents.value) {
    void loadEvents()
    return
  }
  void loadResources()
})

watch(namespace, () => {
  if (currentView.value === 'overview' || isEvents.value) return
  void loadResources()
})
</script>

<template>
  <div class="ws tk-panel" :class="{ 'ws--listing': !activeTab && currentView === 'list' }">
    <Teleport to="#shell-breadcrumbs" defer><div class="ws__crumb">
      <router-link class="ws__crumb-link" :to="{ name: 'clusters' }">资源浏览器</router-link>
      <span class="ws__crumb-sep">/</span>
      <t-select :value="clusterId" :options="clusterList.map((item) => ({ label: item.name, value: item.id }))" filterable borderless class="ws__cluster-switch" aria-label="切换集群" @change="switchCluster" />
      <Teleport to="#shell-page-actions" defer><span class="ws__crumb-actions">
        <t-button size="small" variant="text" :loading="loading" @click="refreshAll">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
        <t-button size="small" variant="text" @click="openTerminal">
          <template #icon><t-icon name="terminal" /></template>
          终端
        </t-button>
        <t-button ref="createTrigger" size="small" theme="primary" @click="createResource">
          <template #icon><t-icon name="add" /></template>
          创建资源
        </t-button>
      </span></Teleport>
    </div></Teleport>

    <div class="ws__tabbar">
      <ResourceWorkspaceTabs class="ws__tabs" variant="cluster" :tabs="clusterTabs" :active="activeTabId" :refreshing="resourceRefreshing" :synced-at="resourceSyncedAt" @select="setActiveTab" @close="closeTab" @menu="tabMenu" @refresh="refreshResourceTab">
        <template #fixed>
        <button
          type="button"
          class="ws__tab"
          :class="{ 'ws__tab--active': !activeTabId && currentView === 'overview' }"
          @click="setView('overview')"
        >
          概览
        </button>
        <button
          type="button"
          class="ws__tab"
          :class="{ 'ws__tab--active': !activeTabId && currentView === 'list' }"
          @click="setView('list')"
        >
          {{ currentKind }}
        </button>
        </template>
      </ResourceWorkspaceTabs>

      <t-button size="small" variant="text" title="集群终端" aria-label="集群终端" @click="openTerminal"><t-icon name="terminal" /></t-button>
      <span class="ws__tab-actions"><span class="ws__conn" :class="`ws__conn--${connectionTone}`"><i class="ws__dot" />{{ connectionLabel }}</span></span>
    </div>

    <ErrorState v-if="error" :message="error" @retry="refreshAll" />

    <t-loading v-else :loading="loading">
      <ResourceDetailPanel
        ref="resourcePanel"
        v-if="activeTab"
        :key="activeTab.id"
        :cluster-id="activeTab.clusterId"
        :group="activeTab.group"
        :resource="activeTab.resource"
        :namespace="activeTab.namespace"
        :name="activeTab.name"
        :tab="activeTab.tab"
        :initial-container="activeTab.container"
        :terminal-context="{ 集群: cluster?.name ?? clusterId, 命名空间: activeTab.namespace }"
        @update:tab="onPanelTab"
        @update:container="detailLocation.container"
        @deleted="closeTab(activeTab.id); loadResources()"
        @changed="loadResources()"
        @synced="onResourceSynced"
      />

      <ClusterOverviewPanel
        v-else-if="currentView === 'overview'"
        :cluster="cluster"
        :overview="overview"
      />

      <div v-else class="ws__body">
        <K8sKindTree :types="treeTypes" :pinned="pinnedKinds" :active="activeResource" :active-group="activeType?.group" :shortcuts-disabled="createVisible" @select="selectKind" />

        <section class="ws__main">
          <div v-if="!isNodes" class="ws__list-toolbar">
            <t-input v-model="keyword" class="ws__search list-search" size="small" clearable :placeholder="`搜索 ${currentKind}`" aria-label="搜索资源"><template #prefix-icon><t-icon name="search" /></template><template #suffix><kbd>/</kbd></template></t-input>
            <t-radio-group v-if="isEvents" v-model="eventType" variant="default-filled" size="small" class="ws__event-type" aria-label="事件类型"><t-radio-button value="warning">Warning</t-radio-button><t-radio-button value="normal">Normal</t-radio-button></t-radio-group>
            <span class="u-right" />
            <t-select v-if="isEvents || activeType?.namespaced" v-model="namespace" :options="namespaceOptions" filterable size="small" class="ws__namespace-select" aria-label="筛选命名空间" />
            <t-button size="small" variant="text" title="刷新资源" :loading="tableLoading || eventsLoading" @click="isEvents ? loadEvents() : loadResources()"><t-icon name="refresh" /></t-button>
          </div>
          <div v-if="isEvents" class="ws__events">
            <ErrorState v-if="eventsError" :message="eventsError" @retry="loadEvents" />
            <ResourceEventsTable v-else :rows="eventRows" :state="tableState" :loading="eventsLoading" @sort="listState.changeSort" @page="listState.changePage" @size="listState.changeSize" />
          </div>

          <template v-else>
            <t-alert v-if="listError" theme="error" :message="listError" class="ws__alert" />

            <ResourceListTable :rows="rows" :columns="columns" :loading="tableLoading" :resource="activeResource" :group="activeType?.group" :state="tableState" :selection-key="selectionKey" @sort="listState.changeSort" @page="listState.changePage" @size="listState.changeSize" @open="openResourceTab" @action="openAction" @node="openNode">
              <template v-if="isNodes" #toolbar="{ visibleColumns, setColumns }">
                <NodeListFilters :value="nodeFilters" :options="nodeOptions" :search="nodeSearch" :loading="tableLoading" @change="updateNodeFilter" @search="updateNodeFilter('searchKey', $event)" @clear="clearNodeFilters" @refresh="loadResources">
                  <ResourceColumnSelector key="core/nodes" :columns="columns" :value="visibleColumns" @change="setColumns" />
                </NodeListFilters>
              </template>
            </ResourceListTable>
          </template>
        </section>
      </div>
    </t-loading>

    <ResourceActionDialog v-model:visible="actionVisible" :cluster-id="clusterId" :targets="actionTargets" :action="actionType" @completed="onActionCompleted" />

    <ResourceCreateDrawer v-if="createVisible" :cluster-id="clusterId" @close="onCreateClosed" />
  </div>
</template>

<style scoped>
.ws {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 64px);
  margin: -12px -16px -24px;
  border: 0;
  border-radius: 0;
  overflow: hidden;
}
.ws__crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0;
  min-width: 0;
}
.ws__crumb-link {
  color: var(--tk-text-2);
}
.ws__crumb-link:hover {
  color: var(--tk-primary);
}
.ws__crumb-sep {
  color: var(--tk-text-3);
}
.ws__crumb-current {
  font-weight: 600;
}
.ws__crumb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.ws__tabbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  flex: none;
  padding: 0 12px;
  background: #f7f9fc;
  border-bottom: 1px solid var(--tk-border);
}
.ws__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.ws__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  height: 28px;
  padding: 0 8px;
  font: inherit;
  color: var(--tk-text-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--tk-radius);
  cursor: pointer;
  white-space: nowrap;
}
.ws__tab:hover {
  color: var(--tk-primary);
  background: #eef2f9;
}
.ws__tab--active {
  color: var(--tk-primary);
  font-weight: 600;
  background: var(--tk-surface);
  border-color: var(--tk-border);
}
.ws__tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ws__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--tk-text-3);
  border-radius: 3px;
}
.ws__tab-close:hover {
  color: var(--tk-danger);
  background: #fdeceb;
}
.ws__tab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: none;
}
.ws__ns {
  width: 170px;
}
.ws__ns-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  min-width: 150px;
  padding: 0 10px;
  color: #3b444c;
  font-size: 12px;
  background: #fff;
  border: 1px solid #d0d4d9;
  border-radius: 4px;
  cursor: pointer;
}
.ws__ns-pill:hover {
  border-color: #0066cc;
}
.ws__search {
  width: 220px;
}
.ws__conn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.ws__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.ws__conn--ok {
  color: #2ba471;
}
.ws__conn--bad {
  color: var(--tk-danger);
}
.ws__conn--idle {
  color: #b3bac7;
}
.ws__body {
  display: flex;
  flex: 1;
  min-height: calc(100dvh - 100px);
}
.ws__main {
  flex: 1;
  min-width: 0;
  padding: 0 0 8px;
  overflow: auto;
}
.ws__events {
  padding: 8px 12px 12px;
}
.ws__alert {
  margin: 8px 12px 0;
}
.ws__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ws__name-link {
  padding: 0;
  overflow: hidden;
  font: inherit;
  color: var(--tk-primary);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 0;
  cursor: pointer;
}
.ws__name-link:hover {
  text-decoration: underline;
}
.ws__name-meta {
  color: var(--tk-text-3);
  font-size: 11px;
}
.ws__ops {
  display: inline-flex;
}
.ws-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ws-table th {
  padding: 8px 12px;
  color: var(--tk-text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: left;
  background: #f7f9fc;
  border-bottom: 1px solid var(--tk-border);
}
.ws-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--tk-border);
  vertical-align: middle;
}
.ws-table tbody tr:hover {
  background: #f7f9fc;
}
.ws__more {
  padding: 0 4px;
  font: inherit;
  color: var(--tk-text-3);
  background: none;
  border: 0;
  cursor: pointer;
}
.ws__more:hover {
  color: var(--tk-primary);
}
.ws__list-toolbar{display:flex;align-items:center;gap:12px;padding:16px 20px 8px}.ws__namespace-select{width:200px}.ws__event-type{flex-shrink:0}.ws__cluster-switch{width:190px}.ws__list-toolbar kbd{font-size:11px;color:var(--tk-text-3)}
.ws--listing{height:calc(100dvh - 64px)}
.ws--listing > :deep(.t-loading__parent){display:flex;flex:1;flex-direction:column;min-height:0}
.ws--listing .ws__body{min-height:0;overflow:hidden}
.ws--listing .ws__main{display:flex;flex-direction:column;min-height:0;padding-bottom:0;overflow:hidden}
.ws--listing .ws__list-toolbar{flex:none}
.ws--listing .ws__events{display:flex;flex:1;flex-direction:column;min-height:0;padding:0}
</style>
