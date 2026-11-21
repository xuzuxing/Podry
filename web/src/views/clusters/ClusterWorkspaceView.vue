<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQuery } from 'vue-router'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'

import {
  applyResource,
  discoverResources,
  dryRunResource,
  getCluster,
  getClusterOverview,
  listClusterEvents,
  listNamespace,
  listResources,
} from '@/api'
import type { ClusterEventRow, DryRunResult } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import K8sKindTree from '@/components/K8sKindTree.vue'
import ResourceDetailPanel from '@/components/resource/ResourceDetailPanel.vue'
import { useResourceTabsStore } from '@/stores/resourceTabs'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import ClusterOverviewPanel from '@/components/cluster/ClusterOverviewPanel.vue'
import type { Cluster, ClusterOverview, ConnectionStatus, K8sResource, Namespace, ResourceType } from '@/types'
import { fmtRelative } from '@/utils/format'

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
const tabsStore = useResourceTabsStore()

const cluster = ref<Cluster | null>(null)
const types = ref<ResourceType[]>([])
const namespaces = ref<Namespace[]>([])
const resources = ref<K8sResource[]>([])
const clusterEvents = ref<ClusterEventRow[]>([])
const overview = ref<ClusterOverview | null>(null)

/* 创建资源（P1：多文档 YAML → Dry run → Apply） */
const createVisible = ref(false)
const createManifest = ref('')
const createDryRun = ref<DryRunResult | null>(null)
const createLoading = ref(false)
const createApplying = ref(false)
const createError = ref('')

function defaultManifest(namespaceName: string): string {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-api-config
  namespace: ${namespaceName}
data:
  LOG_LEVEL: info
  MAX_RETRY: "3"
`
}
const eventsLoading = ref(false)
const eventsError = ref('')
const defaultResource = ref('')
const loading = ref(false)
const tableLoading = ref(false)
const error = ref('')
const listError = ref('')
const keyword = ref('')
const namespace = ref('all')

let skipKeywordLoad = false

interface ResourceRow {
  id: string
  name: string
  namespace: string
  kind: string
  status: string
  age: string
  group: string
  /** 按 Kind 变化的列值 */
  fields: Record<string, string>
}

/** 不同 Kind 用不同的列（对齐 Devtron Resource Browser） */
const COLUMN_SETS: Record<string, Array<{ key: string; label: string; width?: number }>> = {
  nodes: [
    { key: 'name', label: '名称', width: 300 },
    { key: 'status', label: '状态', width: 110 },
    { key: 'roles', label: '角色', width: 140 },
    { key: 'version', label: '版本', width: 110 },
    { key: 'age', label: '存活时间', width: 110 },
  ],
  pods: [
    { key: 'name', label: '名称', width: 320 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'ready', label: '就绪', width: 80 },
    { key: 'status', label: '状态', width: 130 },
    { key: 'restarts', label: '重启', width: 70 },
    { key: 'node', label: '节点', width: 140 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
  deployments: [
    { key: 'name', label: '名称', width: 300 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'ready', label: '就绪', width: 90 },
    { key: 'status', label: '状态', width: 130 },
    { key: 'age', label: '存活时间', width: 110 },
  ],
  services: [
    { key: 'name', label: '名称', width: 260 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'type', label: '类型', width: 120 },
    { key: 'clusterIP', label: 'Cluster IP', width: 140 },
    { key: 'ports', label: '端口', width: 120 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
  ingresses: [
    { key: 'name', label: '名称', width: 280 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'hosts', label: 'Hosts', width: 220 },
    { key: 'status', label: '状态', width: 120 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
  configmaps: [
    { key: 'name', label: '名称', width: 320 },
    { key: 'namespace', label: '命名空间', width: 160 },
    { key: 'keys', label: 'Keys', width: 90 },
    { key: 'status', label: '状态', width: 120 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
  persistentvolumeclaims: [
    { key: 'name', label: '名称', width: 280 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'capacity', label: '容量', width: 100 },
    { key: 'accessModes', label: '访问模式', width: 150 },
    { key: 'status', label: '状态', width: 100 },
  ],
  jobs: [
    { key: 'name', label: '名称', width: 300 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'completions', label: '完成数', width: 100 },
    { key: 'status', label: '状态', width: 120 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
  cronjobs: [
    { key: 'name', label: '名称', width: 280 },
    { key: 'namespace', label: '命名空间', width: 150 },
    { key: 'schedule', label: 'Schedule', width: 160 },
    { key: 'status', label: '状态', width: 120 },
    { key: 'age', label: '存活时间', width: 100 },
  ],
}

const DEFAULT_COLUMNS = [
  { key: 'name', label: '名称', width: 320 },
  { key: 'namespace', label: '命名空间', width: 170 },
  { key: 'status', label: '状态', width: 140 },
  { key: 'age', label: '存活时间', width: 110 },
]

const columns = computed(() => {
  const set = COLUMN_SETS[activeResource.value] ?? DEFAULT_COLUMNS
  return [...set, { key: 'ops', label: '' }]
})

const eventColumns = [
  { colKey: 'namespace', title: '命名空间', width: 140 },
  { colKey: 'object', title: '对象', width: 300 },
  { colKey: 'type', title: '类型', width: 90 },
  { colKey: 'reason', title: '原因', width: 170 },
  { colKey: 'message', title: '消息' },
  { colKey: 'count', title: '次数', width: 70 },
  { colKey: 'lastSeenAt', title: '最近发生', width: 110 },
]

/** 从 summary / manifest 里抽取该 Kind 特有的列值 */
function fieldsOf(item: K8sResource): Record<string, string> {
  const manifest = item.manifest ?? ''
  const pick = (pattern: RegExp): string => pattern.exec(manifest)?.[1]?.trim() ?? ''
  const ready = /(\d+)\s*\/\s*(\d+)/.exec(item.summary ?? '')
  const restarts = /重启\s*(\d+)/.exec(item.summary ?? '')
  const ports = [...manifest.matchAll(/^\s*-?\s*port:\s*(\d+)/gm)].map((match) => match[1])
  const keyCount = [...manifest.matchAll(/^\s{2}[A-Za-z0-9_.-]+:/gm)].length
  const accessModes = [...manifest.matchAll(/-\s*(ReadWriteOnce|ReadOnlyMany|ReadWriteMany)/g)].map((m) => m[1])

  return {
    ready: ready ? `${ready[1]}/${ready[2]}` : item.status === 'Running' ? '1/1' : '—',
    restarts: restarts ? restarts[1] : '0',
    node: pick(/nodeName:\s*(\S+)/) || '—',
    roles: [...manifest.matchAll(/node-role\.kubernetes\.io\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]).join(', ') || 'worker',
    version: pick(/kubeletVersion:\s*(\S+)/) || '—',
    type: pick(/^\s*type:\s*(\S+)/m) || '—',
    clusterIP: pick(/clusterIP:\s*(\S+)/) || '—',
    ports: ports.length ? ports.join(', ') : '—',
    hosts: [...manifest.matchAll(/^\s*-\s*host:\s*(\S+)/gm)].map((m) => m[1]).join(', ') || '*',
    keys: String(keyCount || 0),
    capacity: pick(/storage:\s*(\S+)/) || '—',
    accessModes: accessModes.join(', ') || '—',
    completions: pick(/completions:\s*(\d+)/) || '—',
    schedule: pick(/schedule:\s*"?([^"\n]+)"?/) || '—',
  }
}

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

const treeTypes = computed(() => types.value.filter((item) => !TREE_EXCLUDED.includes(item.resource)))

const activeResource = computed(() => requestedResource.value || defaultResource.value)
const activeType = computed(() => types.value.find((item) => item.resource === activeResource.value) ?? null)
const isEvents = computed(() => activeResource.value === 'events')
const currentKind = computed(
  () => KIND_LABELS[activeResource.value] ?? activeType.value?.kind ?? activeResource.value,
)
const emptyText = computed(() => `该命名空间下没有 ${currentKind.value}`)

const connectionStatus = computed<ConnectionStatus>(() => cluster.value?.connectionStatus ?? 'unknown')
const connectionLabel = computed(() => connectionLabels[connectionStatus.value])
const connectionTone = computed(() => connectionTones[connectionStatus.value])

const namespaceOptions = computed(() => [
  { label: '全部命名空间', value: 'all' },
  ...namespaces.value.map((item) => ({ label: item.name, value: item.name })),
])

const rows = computed<ResourceRow[]>(() => {
  if (activeResource.value === 'namespaces') {
    return namespaces.value.map((item) => ({
      id: item.uid,
      name: item.name,
      namespace: '—',
      kind: 'Namespace',
      status: item.phase,
      age: '—',
      group: '',
      fields: {},
    }))
  }
  return resources.value.map((item) => ({
    id: item.ref.uid,
    name: item.ref.name,
    namespace: item.ref.namespace,
    kind: item.kind,
    status: item.status,
    age: ageOf(item.manifest),
    group: item.ref.group,
    fields: fieldsOf(item),
  }))
})

const eventRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return clusterEvents.value
    .filter((item) => {
      if (!kw) return true
      return (
        item.name.toLowerCase().includes(kw) ||
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

function ageOf(manifest: string): string {
  const matched = /^\s*creationTimestamp:\s*"?([^"\n]+)"?\s*$/m.exec(manifest)
  const createdAt = matched?.[1]?.trim()
  if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) return '—'
  return fmtRelative(createdAt)
}

function statusTheme(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (['Running', 'Available', 'Active', 'Ready', 'Complete', 'Completed', 'Succeeded', 'Bound'].includes(status)) {
    return 'success'
  }
  if (['Pending', 'Progressing', 'ContainerCreating', 'Terminating'].includes(status)) return 'warning'
  if (['CrashLoopBackOff', 'Error', 'Failed', 'ImagePullBackOff', 'NotReady'].includes(status)) return 'danger'
  return 'default'
}

function pickDefaultResource(resourceTypes: ResourceType[]): string {
  const candidates = resourceTypes.filter((item) => !TREE_EXCLUDED.includes(item.resource))
  if (candidates.some((item) => item.resource === 'deployments')) return 'deployments'
  return candidates[0]?.resource ?? ''
}

async function loadShell(): Promise<void> {
  if (!clusterId.value) return
  loading.value = true
  error.value = ''
  try {
    const [clusterInfo, resourceTypes, namespaceList] = await Promise.all([
      getCluster(clusterId.value),
      discoverResources(clusterId.value),
      listNamespace(clusterId.value),
    ])
    cluster.value = clusterInfo
    types.value = resourceTypes
    namespaces.value = namespaceList
    defaultResource.value = pickDefaultResource(resourceTypes)
  } catch (err) {
    cluster.value = null
    types.value = []
    namespaces.value = []
    error.value = err instanceof Error ? err.message : '集群工作区加载失败'
  } finally {
    loading.value = false
  }
}

async function loadResources(): Promise<void> {
  const resource = activeResource.value
  if (!clusterId.value || !resource) return
  if (resource === 'namespaces') {
    // Namespace 来自 shell 已加载的列表，不需要再查资源接口
    resources.value = []
    tableLoading.value = false
    return
  }
  tableLoading.value = true
  listError.value = ''
  try {
    resources.value = await listResources(clusterId.value, {
      group: activeType.value?.group ?? '',
      resource,
      namespace: namespace.value === 'all' ? undefined : namespace.value,
      keyword: keyword.value.trim() || undefined,
    })
  } catch (err) {
    resources.value = []
    listError.value = err instanceof Error ? err.message : '资源列表加载失败'
  } finally {
    tableLoading.value = false
  }
}

async function loadEvents(): Promise<void> {
  if (!clusterId.value) return
  eventsLoading.value = true
  eventsError.value = ''
  try {
    clusterEvents.value = await listClusterEvents(clusterId.value)
  } catch (err) {
    clusterEvents.value = []
    eventsError.value = err instanceof Error ? err.message : '事件加载失败'
  } finally {
    eventsLoading.value = false
  }
}

async function loadOverview(): Promise<void> {
  if (!clusterId.value) return
  try {
    overview.value = await getClusterOverview(clusterId.value)
  } catch {
    overview.value = null
  }
}

async function refreshAll(): Promise<void> {
  await loadShell()
  if (error.value) return
  if (currentView.value === 'overview') await loadOverview()
  else if (isEvents.value) await loadEvents()
  else await loadResources()
}

function resetSearchAndLoad(): void {
  if (keyword.value !== '') {
    skipKeywordLoad = true
    keyword.value = ''
  }
  void loadResources()
}

function selectKind(resource: string): void {
  if (resource === activeResource.value && currentView.value === 'list') return
  const query: LocationQuery = { ...route.query, resource }
  delete query.view
  delete query.tab
  void router.replace({ query })
}

function setActiveTab(id: string): void {
  const query: LocationQuery = { ...route.query }
  if (id) query.tab = id
  else delete query.tab
  void router.replace({ query })
}

function setView(view: 'overview' | 'list'): void {
  const query: LocationQuery = { ...route.query }
  delete query.tab
  if (view === 'overview') {
    delete query.view
    delete query.resource
  } else {
    delete query.view
    query.resource = activeResource.value || defaultResource.value
  }
  void router.replace({ query })
}

function openResourceTab(row: ResourceRow, tab: ResourceTabKey = 'manifest'): void {
  if (activeResource.value === 'nodes') {
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

function closeTab(id: string, event?: Event): void {
  event?.stopPropagation()
  const wasActive = id === activeTabId.value
  tabsStore.close(clusterId.value, id)
  if (wasActive) {
    const remaining = clusterTabs.value
    setActiveTab(remaining.length ? remaining[remaining.length - 1].id : '')
  }
}

function onPanelTab(tab: ResourceTabKey): void {
  if (activeTab.value) tabsStore.setTab(activeTab.value.id, tab)
}

function onRowClick(context: { row: unknown; e?: Event }): void {
  const target = context.e?.target
  if (target instanceof Element && target.closest('.ws__ops, a')) return
  openResourceTab(context.row as ResourceRow)
}

function confirmDelete(row: ResourceRow): void {
  const dialog = DialogPlugin.confirm({
    header: '删除资源',
    body: `确认删除 ${row.kind} ${row.name}（${row.namespace}）？删除后不可恢复。`,
    theme: 'danger',
    confirmBtn: '删除',
    cancelBtn: '取消',
    onConfirm: () => {
      dialog.hide()
      MessagePlugin.info(`静态演示：将调用 DELETE ${activeResource.value}/${row.name}`)
    },
    onClose: () => dialog.hide(),
  })
}

const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']

function rowMenuOptions(row: ResourceRow): Array<{ content: string; value: string; theme?: 'error' }> {
  const options: Array<{ content: string; value: string; theme?: 'error' }> = [
    { content: activeResource.value === 'nodes' ? '查看节点详情' : '在新页签打开', value: 'detail' },
  ]
  if (WORKLOAD_KINDS.includes(row.kind)) {
    options.push({ content: '重启工作负载', value: 'restart' })
    options.push({ content: '扩缩容', value: 'scale' })
  }
  if (row.kind === 'Node') {
    options.push({ content: 'Cordon / Uncordon', value: 'cordon' })
    options.push({ content: 'Drain 节点', value: 'drain' })
  }
  if (row.kind === 'Pod') {
    options.push({ content: '查看日志', value: 'logs' })
  }
  options.push({ content: '删除资源', value: 'delete', theme: 'error' })
  return options
}

function onMenuClick(row: ResourceRow, payload: unknown): void {
  const value = (payload as { value?: string } | null)?.value
  if (value === 'detail') openResourceTab(row)
  else if (value === 'delete') confirmDelete(row)
  else if (value === 'restart') {
    MessagePlugin.success(`已提交重启：${row.kind}/${row.name}（mock，真实集群按滚动策略重建 Pod）`)
  } else if (value === 'scale') {
    openResourceTab(row)
    MessagePlugin.info('在详情面板里使用「扩缩容」调整副本数')
  } else if (value === 'cordon') {
    MessagePlugin.success(`已提交 Cordon/Uncordon：${row.name}（mock）`)
  } else if (value === 'drain') {
    MessagePlugin.warning(`已提交 Drain：${row.name}（mock，会先驱逐工作负载）`)
  } else if (value === 'logs') {
    openResourceTab(row, 'logs')
  }
}

function openTerminal(): void {
  void router.push({ name: 'cluster-terminal', params: { clusterId: clusterId.value } })
}

function createResource(): void {
  createManifest.value = defaultManifest(namespace.value === 'all' ? 'default' : namespace.value)
  createDryRun.value = null
  createError.value = ''
  createVisible.value = true
}

async function dryRunCreate(): Promise<void> {
  createLoading.value = true
  createError.value = ''
  try {
    createDryRun.value = await dryRunResource(clusterId.value, { manifest: createManifest.value })
  } catch (err) {
    createError.value = err instanceof Error ? err.message : 'Dry run 失败'
  } finally {
    createLoading.value = false
  }
}

async function applyCreate(): Promise<void> {
  createApplying.value = true
  createError.value = ''
  try {
    const result = await applyResource(clusterId.value, { manifest: createManifest.value })
    if (result.status === 'succeeded') {
      MessagePlugin.success(`已应用 ${result.items.length} 个对象（静态演示）`)
      createVisible.value = false
      if (currentView.value === 'list') await loadResources()
      else setView('list')
    } else {
      const failed = result.items.find((item) => item.result !== 'succeeded')
      createError.value = failed?.message ?? '应用失败'
    }
  } catch (err) {
    createError.value = err instanceof Error ? err.message : '应用失败'
  } finally {
    createApplying.value = false
  }
}

function consumeOpenQuery(): void {
  const raw = route.query.open
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return
  const [group = '', resource = '', namespace = '', name = ''] = String(value).split(',')
  if (!resource || !name) return
  const kind = types.value.find((item) => item.resource === resource)?.kind ?? resource
  const id = tabsStore.open({
    clusterId: clusterId.value,
    group: group === 'core' || group === '_' ? '' : group,
    resource,
    namespace,
    name,
    kind,
  })
  const query: LocationQuery = { ...route.query, tab: id }
  delete query.open
  delete query.view
  void router.replace({ query })
}

watch(
  clusterId,
  () => {
    namespace.value = 'all'
    keyword.value = ''
    void (async () => {
      await refreshAll()
      consumeOpenQuery()
    })()
  },
  { immediate: true },
)

watch([requestedResource, legacyView], () => {
  if (currentView.value === 'overview') {
    void loadOverview()
    return
  }
  if (isEvents.value) {
    void loadEvents()
    return
  }
  resetSearchAndLoad()
})

watch(namespace, () => {
  if (currentView.value === 'overview' || isEvents.value) return
  resetSearchAndLoad()
})

watch(keyword, () => {
  if (skipKeywordLoad) {
    skipKeywordLoad = false
    return
  }
  if (currentView.value === 'overview' || isEvents.value) return
  void loadResources()
})
</script>

<template>
  <div class="ws tk-panel">
    <div class="ws__crumb">
      <router-link class="ws__crumb-link" :to="{ name: 'clusters' }">资源浏览器</router-link>
      <span class="ws__crumb-sep">/</span>
      <span class="ws__crumb-current">{{ cluster?.name ?? '集群工作区' }}</span>
      <span class="ws__crumb-actions">
        <t-button size="small" variant="text" :loading="loading" @click="refreshAll">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
        <t-button size="small" variant="text" @click="openTerminal">
          <template #icon><t-icon name="terminal" /></template>
          终端
        </t-button>
        <t-button size="small" theme="primary" @click="createResource">
          <template #icon><t-icon name="add" /></template>
          创建资源
        </t-button>
      </span>
    </div>

    <div class="ws__tabbar">
      <div class="ws__tabs">
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
        <button
          v-for="tab in clusterTabs"
          :key="tab.id"
          type="button"
          class="ws__tab"
          :class="{ 'ws__tab--active': activeTabId === tab.id }"
          :title="`${tab.kind} / ${tab.name}`"
          @click="setActiveTab(tab.id)"
        >
          <span class="ws__tab-label">{{ tab.kind.toLowerCase() }}/{{ tab.name }}</span>
          <span class="ws__tab-close" role="button" @click="closeTab(tab.id, $event)">
            <t-icon name="close" size="12px" />
          </span>
        </button>
      </div>

      <div
        v-if="!activeTabId && currentView === 'list' && !isEvents && !['nodes', 'namespaces'].includes(activeResource)"
        class="ws__tab-actions"
      >
        <t-select v-model="namespace" class="ws__ns" size="small" :options="namespaceOptions" />
        <t-input
          v-model="keyword"
          class="ws__search"
          size="small"
          clearable
          :placeholder="`搜索 ${currentKind}`"
        >
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-button
          size="small"
          variant="text"
          title="刷新"
          :loading="tableLoading"
          @click="loadResources()"
        >
          <template #icon><t-icon name="refresh" /></template>
        </t-button>
      </div>
      <div v-else-if="!activeTabId && currentView === 'list' && isEvents" class="ws__tab-actions">
        <t-input v-model="keyword" class="ws__search" size="small" clearable placeholder="按事件搜索">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-button size="small" variant="text" title="刷新" :loading="eventsLoading" @click="loadEvents()">
          <template #icon><t-icon name="refresh" /></template>
        </t-button>
      </div>
      <div v-else-if="activeTabId" class="ws__tab-actions">
        <span class="ws__conn" :class="`ws__conn--${connectionTone}`">
          <i class="ws__dot" />
          {{ connectionLabel }}
        </span>
        <span class="ws__crumb-sep">·</span>
        <span class="u-dim">{{ cluster?.name }}</span>
      </div>
    </div>

    <ErrorState v-if="error" :message="error" @retry="refreshAll" />

    <t-loading v-else :loading="loading">
      <ResourceDetailPanel
        v-if="activeTab"
        :key="activeTab.id"
        :cluster-id="activeTab.clusterId"
        :group="activeTab.group"
        :resource="activeTab.resource"
        :namespace="activeTab.namespace"
        :name="activeTab.name"
        :tab="activeTab.tab"
        @update:tab="onPanelTab"
      />

      <ClusterOverviewPanel
        v-else-if="currentView === 'overview'"
        :cluster="cluster"
        :overview="overview"
      />

      <div v-else class="ws__body">
        <K8sKindTree :types="treeTypes" :pinned="PINNED_KINDS" :active="activeResource" @select="selectKind" />

        <section class="ws__main">
          <div v-if="isEvents" class="ws__events">
            <ErrorState v-if="eventsError" :message="eventsError" @retry="loadEvents" />
            <t-loading v-else :loading="eventsLoading">
              <t-table row-key="id" :data="eventRows" :columns="eventColumns" size="small" hover>
                <template #namespace="{ row }"><span class="u-mono">{{ row.namespace }}</span></template>
                <template #object="{ row }"><span class="u-mono">{{ row.object }}</span></template>
                <template #type="{ row }">
                  <t-tag :theme="row.type === 'Warning' ? 'danger' : 'success'" variant="light" size="small">{{ row.type }}</t-tag>
                </template>
                <template #reason="{ row }"><span class="u-mono">{{ row.reason }}</span></template>
                <template #message="{ row }"><span class="u-muted">{{ row.message }}</span></template>
                <template #count="{ row }">{{ row.count }}</template>
                <template #lastSeenAt="{ row }">{{ fmtRelative(row.lastSeenAt) }}</template>
                <template #empty>
                  <EmptyState title="没有集群事件" description="当前授权范围内没有可读事件。" icon="history" compact />
                </template>
              </t-table>
            </t-loading>
          </div>

          <template v-else>
            <t-alert v-if="listError" theme="error" :message="listError" class="ws__alert" />

            <t-loading :loading="tableLoading">
              <table v-if="rows.length" class="ws-table">
                <thead>
                  <tr>
                    <th v-for="col in columns" :key="col.key" :style="col.width ? { width: `${col.width}px` } : undefined">
                      {{ col.label.toUpperCase() }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.id" @click="onRowClick({ row })">
                    <td v-for="col in columns" :key="col.key">
                      <template v-if="col.key === 'name'">
                        <div class="ws__name">
                          <button type="button" class="ws__name-link" @click.stop="openResourceTab(row)">
                            {{ row.name }}
                          </button>
                          <span class="ws__name-meta">{{ row.kind }} · {{ row.status }}</span>
                        </div>
                      </template>
                      <template v-else-if="col.key === 'status'">
                        <t-tag :theme="statusTheme(row.status)" variant="light" size="small">{{ row.status }}</t-tag>
                      </template>
                      <template v-else-if="col.key === 'age'">{{ row.age }}</template>
                      <template v-else-if="col.key === 'namespace'">
                        <span class="u-mono">{{ row.namespace }}</span>
                      </template>
                      <template v-else-if="col.key === 'ops'">
                        <span class="ws__ops">
                          <t-dropdown
                            trigger="click"
                            placement="bottom-right"
                            :options="rowMenuOptions(row)"
                            @click="onMenuClick(row, $event)"
                          >
                            <button class="ws__more" type="button" title="更多操作">⋮</button>
                          </t-dropdown>
                        </span>
                      </template>
                      <template v-else>
                        <span class="u-mono">{{ row.fields[col.key] ?? '—' }}</span>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>

              <EmptyState
                v-else-if="!tableLoading"
                :title="emptyText"
                description="可切换命名空间、资源类型或调整搜索关键字后重试。"
                icon="layers"
                compact
              />
            </t-loading>
          </template>
        </section>
      </div>
    </t-loading>

    <t-drawer v-model:visible="createVisible" header="创建资源" size="760px" placement="right" :footer="false">
      <div class="ws__create">
        <p class="u-muted">支持多文档（<span class="u-mono">---</span> 分隔）。提交前先 Dry run，再应用到当前集群的本地 mock。</p>
        <t-alert v-if="createError" theme="error" :message="createError" />
        <t-textarea v-model="createManifest" class="ws__create-editor" :autosize="{ minRows: 20, maxRows: 34 }" />
        <div v-if="createDryRun" class="ws__create-result">
          <t-table
            row-key="index"
            size="small"
            :data="createDryRun.documents"
            :columns="[
              { colKey: 'index', title: '#', width: 46 },
              { colKey: 'ref', title: '对象', width: 240 },
              { colKey: 'status', title: 'Dry run', width: 90 },
              { colKey: 'message', title: '说明' },
            ]"
          >
            <template #ref="{ row }"><span class="u-mono">{{ row.ref }}</span></template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'valid' ? 'success' : 'danger'" variant="light" size="small">
                {{ row.status === 'valid' ? '通过' : '不通过' }}
              </t-tag>
            </template>
          </t-table>
        </div>
        <div class="ws__create-actions">
          <t-button variant="outline" @click="createVisible = false">取消</t-button>
          <t-button variant="outline" :loading="createLoading" @click="dryRunCreate">Dry run</t-button>
          <t-button theme="primary" :loading="createApplying" :disabled="!createDryRun?.valid" @click="applyCreate">
            应用
          </t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.ws {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 88px);
  overflow: hidden;
}
.ws__crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
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
  height: 44px;
  padding: 0 12px;
  background: #f7f9fc;
  border-bottom: 1px solid var(--tk-border);
}
.ws__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
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
  min-height: 0;
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
.ws__create {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ws__create-editor {
  font-family: var(--tk-mono);
  font-size: 12px;
}
.ws__create-result {
  max-height: 220px;
  overflow: auto;
}
.ws__create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
