<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { listClusters, listNamespace } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { Cluster, ConnectionStatus } from '@/types'
import { fmtRelative } from '@/utils/format'

/** 表格行：集群 + 逐个集群统计出的 Namespace 条数 */
interface ClusterRow {
  id: string
  name: string
  serverVersion: string
  nodeCount: number
  namespaceCount: string
  connectionLabel: string
  connectionTone: 'ok' | 'bad' | 'idle'
  lastCheckedAt: string | null
}

const connectionLabels: Record<ConnectionStatus, string> = {
  connected: '已连接',
  unavailable: '连接不可用',
  unknown: '未检测',
}

const connectionTones: Record<ConnectionStatus, ClusterRow['connectionTone']> = {
  connected: 'ok',
  unavailable: 'bad',
  unknown: 'idle',
}

const router = useRouter()

const clusters = ref<Cluster[]>([])
const namespaceCounts = ref<Record<string, number>>({})
const loading = ref(false)
const error = ref('')

const columns = [
  { colKey: 'name', title: '集群名称', width: 300 },
  { colKey: 'serverVersion', title: '版本', width: 180 },
  { colKey: 'nodeCount', title: '节点数', width: 110 },
  { colKey: 'namespaceCount', title: '命名空间数', width: 140 },
  { colKey: 'connectionLabel', title: '连接状态', width: 200 },
  { colKey: 'lastCheckedAt', title: '最近检测', width: 170 },
  { colKey: 'ops', title: '', width: 56 },
]

const rows = computed<ClusterRow[]>(() =>
  clusters.value.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    serverVersion: cluster.serverVersion ?? '—',
    nodeCount: cluster.nodeCount,
    namespaceCount: String(namespaceCounts.value[cluster.id] ?? '—'),
    connectionLabel: connectionLabels[cluster.connectionStatus],
    connectionTone: connectionTones[cluster.connectionStatus],
    lastCheckedAt: cluster.lastCheckedAt,
  })),
)

const connectedCount = computed(() => clusters.value.filter((item) => item.connectionStatus === 'connected').length)
const nodeTotal = computed(() => clusters.value.reduce((total, item) => total + item.nodeCount, 0))
const namespaceTotal = computed(() =>
  Object.values(namespaceCounts.value).reduce((total, count) => total + count, 0),
)

/** 顶部一行 4 个小统计块，对应截图里的集群概览条 */
const stats = computed(() => [
  { key: 'clusters', label: 'Clusters', value: clusters.value.length },
  { key: 'connected', label: 'Connected', value: connectedCount.value },
  { key: 'nodes', label: 'Nodes', value: nodeTotal.value },
  { key: 'namespaces', label: 'Namespaces', value: namespaceTotal.value },
])

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const list = await listClusters()
    clusters.value = list
    // NAMESPACES 列取 listNamespace 的条数，与工作区的命名空间下拉同源
    const counts = await Promise.all(
      list.map(async (cluster) => [cluster.id, (await listNamespace(cluster.id)).length] as const),
    )
    namespaceCounts.value = Object.fromEntries(counts)
  } catch (err) {
    clusters.value = []
    namespaceCounts.value = {}
    error.value = err instanceof Error ? err.message : '集群列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCluster(clusterId: string): void {
  void router.push({ name: 'cluster-workspace', params: { clusterId } })
}

function goSettings(): void {
  void router.push({ name: 'settings-clusters' })
}

function testConnection(row: ClusterRow): void {
  MessagePlugin.info(`静态演示：将调用 POST /clusters/${row.id}/connection-test`)
}

function onMenuClick(row: ClusterRow, payload: unknown): void {
  const value = (payload as { value?: string } | null)?.value
  if (value === 'enter') openCluster(row.id)
  if (value === 'test') testConnection(row)
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="clusters">
    <div class="clusters__bar">
      <div class="clusters__stats tk-panel">
        <div v-for="stat in stats" :key="stat.key" class="clusters__stat">
          <span class="clusters__stat-value">{{ stat.value }}</span>
          <span class="clusters__stat-label">{{ stat.label }}</span>
        </div>
      </div>
      <div class="clusters__actions">
        <t-button size="small" variant="text" :loading="loading" @click="load">
          <template #icon>
            <t-icon name="refresh" />
          </template>
          刷新
        </t-button>
        <t-button theme="primary" size="small" @click="goSettings">
          <template #icon>
            <t-icon name="add" />
          </template>
          接入集群
        </t-button>
      </div>
    </div>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <section class="tk-panel clusters__table">
        <t-table row-key="id" :data="rows" :columns="columns" size="small" hover>
          <template #name="{ row }">
            <div class="clusters__name">
              <span class="clusters__mark"><t-icon name="server" size="12px" /></span>
              <router-link class="clusters__link" :to="{ name: 'cluster-workspace', params: { clusterId: row.id } }">
                {{ row.name }}
              </router-link>
            </div>
          </template>
          <template #serverVersion="{ row }">
            <span class="clusters__version">{{ row.serverVersion }}</span>
          </template>
          <template #nodeCount="{ row }">
            <span class="clusters__value">{{ row.nodeCount }}</span>
          </template>
          <template #namespaceCount="{ row }">
            <span class="clusters__value">{{ row.namespaceCount }}</span>
          </template>
          <template #connectionLabel="{ row }">
            <span class="clusters__conn" :class="`clusters__conn--${row.connectionTone}`">
              <i class="clusters__dot" />
              {{ row.connectionLabel }}
            </span>
          </template>
          <template #lastCheckedAt="{ row }">
            <span class="clusters__value">{{ fmtRelative(row.lastCheckedAt) }}</span>
          </template>
          <template #ops="{ row }">
            <t-dropdown
              trigger="click"
              placement="bottom-right"
              :options="[
                { content: '进入工作区', value: 'enter' },
                { content: '连接测试', value: 'test' },
              ]"
              @click="onMenuClick(row, $event)"
            >
              <button class="clusters__more" type="button" title="更多操作">⋮</button>
            </t-dropdown>
          </template>
          <template #empty>
            <EmptyState
              v-if="!loading"
              title="还没有接入集群"
              description="前往「平台设置 → 集群接入」填写 API Server 与凭据，接入后即可按 Kind 浏览资源。"
              icon="cloud"
            >
              <template #action>
                <t-button size="small" variant="outline" @click="goSettings">去设置</t-button>
              </template>
            </EmptyState>
          </template>
        </t-table>
      </section>
    </t-loading>
  </div>
</template>

<style scoped>
.clusters {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 84px);
}
.clusters__bar {
  display: flex;
  flex: none;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 12px;
}
/* 加载态包裹层撑满剩余高度，表格白底一直铺到页面底部（对齐 Devtron 列表页） */
.clusters > :deep(.t-loading__parent) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.clusters__stats {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  min-width: 0;
  overflow: hidden;
}
.clusters__stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  justify-content: center;
  padding: 8px 16px;
  border-left: 1px solid var(--tk-border);
}
.clusters__stat:first-child {
  border-left: 0;
}
.clusters__stat-value {
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
}
.clusters__stat-label {
  color: var(--tk-text-3);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.clusters__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clusters__table {
  flex: 1;
  overflow: hidden;
}
.clusters__table :deep(.t-table td) {
  height: 40px;
  padding: 0 12px !important;
}
.clusters__table :deep(.t-table th) {
  height: 36px;
  padding: 0 12px !important;
}
.clusters__name {
  display: flex;
  gap: 8px;
  align-items: center;
}
.clusters__mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--tk-primary);
  background: var(--tk-primary-weak);
  border-radius: 3px;
}
.clusters__link {
  font-weight: 500;
}
.clusters__version {
  color: var(--tk-text-2);
  font-family: var(--tk-mono);
  font-size: 11px;
}
.clusters__value {
  color: var(--tk-text-2);
}
.clusters__conn {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}
.clusters__dot {
  width: 7px;
  height: 7px;
  background: currentColor;
  border-radius: 50%;
}
.clusters__conn--ok {
  color: #2ba471;
}
.clusters__conn--bad {
  color: var(--tk-danger);
}
.clusters__conn--idle {
  color: var(--tk-text-3);
}
.clusters__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--tk-text-3);
  font-size: 15px;
  line-height: 1;
  background: none;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.clusters__more:hover {
  color: var(--tk-primary);
  background: #f2f6fd;
}
</style>
