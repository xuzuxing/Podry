<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { listClusters } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import type { Cluster, ConnectionStatus } from '@/types'

interface ClusterRow {
  id: string
  name: string
  typeLabel: string
  serverVersion: string
  nodeCount: number
  nodeErrors: number
  cpuCapacity: string
  memoryCapacity: string
  connectionLabel: string
  connectionTone: 'ok' | 'bad' | 'idle'
  lastCheckedAt: string | null
}

const connectionLabels: Record<ConnectionStatus, string> = {
  connected: '健康',
  unavailable: '不可用',
  unknown: '未检测',
}

const connectionTones: Record<ConnectionStatus, ClusterRow['connectionTone']> = {
  connected: 'ok',
  unavailable: 'bad',
  unknown: 'idle',
}

const router = useRouter()

const clusters = ref<Cluster[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const statusFilter = ref('')
const refreshedAt = ref(Date.now())
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

const statusOptions = [
  { label: '全部集群', value: '' },
  { label: '健康', value: 'connected' },
  { label: '不可用', value: 'unavailable' },
  { label: '未检测', value: 'unknown' },
]

const columns = [
  { colKey: 'name', title: '集群', width: 260 },
  { colKey: 'connectionLabel', title: '状态', width: 120 },
  { colKey: 'typeLabel', title: '类型', width: 140 },
  { colKey: 'nodeCount', title: '节点', width: 90 },
  { colKey: 'nodeErrors', title: '节点错误', width: 110 },
  { colKey: 'serverVersion', title: 'K8s 版本', width: 150 },
  { colKey: 'cpuCapacity', title: 'CPU 容量', width: 120 },
  { colKey: 'memoryCapacity', title: '内存容量', width: 130 },
  { colKey: 'ops', title: '', width: 56 },
]

const rows = computed<ClusterRow[]>(() =>
  clusters.value
    .filter((cluster) => {
      if (keyword.value && !cluster.name.toLowerCase().includes(keyword.value.trim().toLowerCase())) return false
      if (statusFilter.value && cluster.connectionStatus !== statusFilter.value) return false
      return true
    })
    .map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      typeLabel: cluster.production ? '生产环境' : '非生产',
      serverVersion: cluster.serverVersion ?? '—',
      nodeCount: cluster.nodeCount,
      nodeErrors: cluster.nodeErrors ?? 0,
      cpuCapacity: cluster.cpuCapacity ?? '—',
      memoryCapacity: cluster.memoryCapacity ?? '—',
      connectionLabel: connectionLabels[cluster.connectionStatus],
      connectionTone: connectionTones[cluster.connectionStatus],
      lastCheckedAt: cluster.lastCheckedAt,
    })),
)

const healthyCount = computed(() => clusters.value.filter((item) => item.connectionStatus === 'connected').length)
const productionCount = computed(() => clusters.value.filter((item) => item.production).length)
const healthyPercent = computed(() =>
  clusters.value.length ? Math.round((healthyCount.value / clusters.value.length) * 100) : 0,
)
const productionPercent = computed(() =>
  clusters.value.length ? Math.round((productionCount.value / clusters.value.length) * 100) : 0,
)

const refreshedLabel = computed(() => {
  const seconds = Math.max(0, Math.round((now.value - refreshedAt.value) / 1000))
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  return `${Math.round(seconds / 60)} 分钟前`
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    clusters.value = await listClusters()
    refreshedAt.value = Date.now()
    now.value = Date.now()
  } catch (err) {
    clusters.value = []
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
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="clusters">
    <div class="clusters__toolbar">
      <div class="clusters__toolbar-left">
        <t-input v-model="keyword" class="clusters__search" size="small" clearable placeholder="搜索集群">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <t-select v-model="statusFilter" :options="statusOptions" class="clusters__filter" size="small" />
      </div>
      <div class="clusters__toolbar-right">
        <span class="clusters__refreshed">最近刷新 {{ refreshedLabel }}</span>
        <t-button size="small" variant="text" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
        <t-button theme="primary" size="small" @click="goSettings">
          <template #icon><t-icon name="add" /></template>
          接入集群
        </t-button>
      </div>
    </div>

    <div class="clusters__summary">
      <section class="clusters__summary-card">
        <p class="clusters__summary-value">{{ healthyCount }}/{{ clusters.length }}</p>
        <p class="clusters__summary-label"><i class="clusters__summary-dot" />健康</p>
        <div class="clusters__summary-bar">
          <span class="clusters__summary-fill" :style="{ width: `${healthyPercent}%` }" />
        </div>
      </section>
      <section class="clusters__summary-card">
        <p class="clusters__summary-value">{{ productionCount }}/{{ clusters.length }}</p>
        <p class="clusters__summary-label"><i class="clusters__summary-dot clusters__summary-dot--muted" />生产环境</p>
        <div class="clusters__summary-bar">
          <span class="clusters__summary-fill clusters__summary-fill--muted" :style="{ width: `${productionPercent}%` }" />
        </div>
      </section>
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
          <template #connectionLabel="{ row }">
            <span class="clusters__conn" :class="`clusters__conn--${row.connectionTone}`">
              <i class="clusters__dot" />
              {{ row.connectionLabel }}
            </span>
          </template>
          <template #typeLabel="{ row }">
            <span class="clusters__type">{{ row.typeLabel }}</span>
          </template>
          <template #nodeErrors="{ row }">
            <span class="clusters__value" :class="{ 'clusters__value--bad': row.nodeErrors > 0 }">{{ row.nodeErrors }}</span>
          </template>
          <template #serverVersion="{ row }">
            <span class="clusters__version">{{ row.serverVersion }}</span>
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
.clusters__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.clusters__toolbar-left,
.clusters__toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clusters__search {
  width: 240px;
}
.clusters__filter {
  width: 130px;
}
.clusters__refreshed {
  color: #767d84;
  font-size: 11px;
}
.clusters__summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.clusters__summary-card {
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.clusters__summary-value {
  margin: 0 0 2px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
}
.clusters__summary-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  color: #3b444c;
  font-size: 12px;
}
.clusters__summary-dot {
  width: 8px;
  height: 8px;
  background: #1dad70;
  border-radius: 1px;
}
.clusters__summary-dot--muted {
  background: #b1b7bc;
}
.clusters__summary-bar {
  height: 6px;
  overflow: hidden;
  background: #edf1f5;
  border-radius: 3px;
}
.clusters__summary-fill {
  display: block;
  height: 100%;
  background: #1dad70;
  border-radius: 3px;
}
.clusters__summary-fill--muted {
  background: #b1b7bc;
}
.clusters > :deep(.t-loading__parent) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.clusters__table {
  flex: 1;
  overflow: hidden;
}
.clusters__table :deep(.t-table td) {
  height: 44px;
  padding: 0 12px !important;
}
.clusters__table :deep(.t-table th) {
  height: 38px;
  padding: 0 12px !important;
  color: #767d84;
  font-size: 11px;
  font-weight: 500;
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
  color: #0066cc;
  font-weight: 500;
}
.clusters__version {
  color: #596168;
  font-family: var(--tk-mono);
  font-size: 11px;
}
.clusters__value {
  color: #3b444c;
}
.clusters__value--bad {
  color: #f33e3e;
}
.clusters__type {
  color: #3b444c;
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
  color: #1dad70;
}
.clusters__conn--bad {
  color: #f33e3e;
}
.clusters__conn--idle {
  color: #767d84;
}
.clusters__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: #767d84;
  font-size: 15px;
  line-height: 1;
  background: none;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.clusters__more:hover {
  color: #0066cc;
  background: #f2f6fd;
}
</style>
