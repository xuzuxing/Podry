<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { InfraClusterRow, InfraNode } from '@/composables/useInfraManagementOverview'
import type { ChartPart } from '@/utils/managementOverview'
import { overviewStatusLabel } from '@/utils/managementOverview'
import OverviewPanel from './OverviewPanel.vue'
import OverviewDonut from './OverviewDonut.vue'
import OverviewEmptyState from './OverviewEmptyState.vue'

const props = defineProps<{ rows: InfraClusterRow[]; nodes: InfraNode[]; healthParts: ChartPart[]; schedulingParts: ChartPart[]; nodeErrors: ChartPart[]; unknownNodes: number; totalNodes: number }>()
const selected = shallowRef<{ kind: 'cluster' | 'error' | 'scheduling'; label: string } | null>(null)
const keyword = shallowRef('')
const errorLabels: Record<string, string> = { NetworkUnavailable: 'Network Unavailable', MemoryPressure: 'Insufficient Memory', DiskPressure: 'Disk Pressure', PIDPressure: 'Insufficient PID', Ready: 'Kubelet Not Ready' }
const title = computed(() => `${selected.value?.kind === 'cluster' ? '集群健康' : selected.value?.kind === 'error' ? '节点错误' : '节点调度'} · ${overviewStatusLabel(selected.value?.label ?? '')}`)
const clusterRows = computed(() => props.rows.filter(({ cluster, overview }) => {
  const label = cluster.connectionStatus !== 'connected' ? 'Connection Failed' : overview?.status ?? 'Unknown'
  return label === selected.value?.label && cluster.name.toLowerCase().includes(keyword.value.trim().toLowerCase())
}))
const nodeRows = computed(() => props.nodes.filter(node => {
  const selection = selected.value
  const matches = selection?.kind === 'error' ? node.detail.conditions.some(condition => condition.haveIssue && (errorLabels[condition.type] ?? 'Other Errors') === selection.label)
    : selection?.label === 'Unschedulable' ? node.detail.unschedulable : selection?.label === 'Schedulable' ? !node.detail.unschedulable : false
  return matches && `${node.detail.name} ${node.clusterName}`.toLowerCase().includes(keyword.value.trim().toLowerCase())
}))
watch(selected, () => { keyword.value = '' })
</script>

<template>
  <div class="overview-grid">
    <OverviewPanel title="集群健康状态"><OverviewDonut :parts="healthParts" label="集群" interactive @select="selected = { kind: 'cluster', label: $event.label }" /></OverviewPanel>
    <OverviewPanel title="节点错误"><OverviewDonut v-if="nodeErrors.length" :parts="nodeErrors" label="错误" interactive @select="selected = { kind: 'error', label: $event.label }" /><OverviewEmptyState v-else :title="unknownNodes ? '已读取的节点未发现错误' : '暂无节点错误'" :description="unknownNodes ? `${nodes.length} 个已读取节点未发现错误，另有 ${unknownNodes} 个节点详情未知。` : '节点运行正常，未发现错误。'" icon="check-circle" /></OverviewPanel>
    <OverviewPanel title="节点调度状态"><OverviewDonut :parts="schedulingParts" label="节点" interactive @select="selected = { kind: 'scheduling', label: $event.label }" /></OverviewPanel>
  </div>
  <p v-if="unknownNodes" class="overview-note">已读取 {{ nodes.length }} / {{ totalNodes }} 个节点详情；其余节点的健康、调度及自动扩缩容状态保留为“未知”。</p>
  <t-drawer :visible="!!selected" :header="title" size="min(900px, 90vw)" :footer="false" :close-btn="true" destroy-on-close @close="selected = null">
    <div class="health-details">
      <t-input v-model="keyword" placeholder="搜索名称或集群" aria-label="搜索健康详情" clearable><template #prefix-icon><t-icon name="search" /></template></t-input>
      <template v-if="selected?.kind === 'cluster'">
        <table v-if="clusterRows.length" class="health-details__table"><thead><tr><th>集群</th><th>状态</th><th>节点数</th><th>Kubernetes 版本</th></tr></thead><tbody><tr v-for="row in clusterRows" :key="row.cluster.id"><td><router-link :to="{ name: 'cluster-workspace', params: { clusterId: row.cluster.id } }">{{ row.cluster.name }}</router-link></td><td>{{ overviewStatusLabel(row.cluster.connectionStatus === 'connected' ? row.overview?.status ?? 'Unknown' : 'Connection Failed') }}</td><td>{{ row.cluster.nodeCount }}</td><td>{{ row.cluster.serverVersion ?? '—' }}</td></tr></tbody></table>
        <OverviewEmptyState v-else title="没有匹配的集群" />
      </template>
      <template v-else>
        <table v-if="nodeRows.length" class="health-details__table"><thead><tr><th>节点</th><th>集群</th><th>状态</th><th>调度状态</th></tr></thead><tbody><tr v-for="node in nodeRows" :key="`${node.clusterId}:${node.detail.name}`"><td><router-link :to="{ name: 'node-detail', params: { clusterId: node.clusterId, nodeName: node.detail.name, tab: 'summary' } }">{{ node.detail.name }}</router-link></td><td>{{ node.clusterName }}</td><td>{{ overviewStatusLabel(node.detail.status) }}</td><td>{{ node.detail.unschedulable ? '不可调度' : '可调度' }}</td></tr></tbody></table>
        <OverviewEmptyState v-else :title="selected?.label === 'Unknown' ? '节点详情不可用' : '没有匹配的节点'" :description="selected?.label === 'Unknown' ? `${unknownNodes} 个节点没有详情，无法识别具体名称和状态。请刷新后重试。` : ''" />
      </template>
    </div>
  </t-drawer>
</template>

<style scoped>
.health-details{display:flex;flex-direction:column;gap:16px}.health-details__table{width:100%;border-collapse:collapse;font-size:13px}.health-details__table th{padding:10px 8px;text-align:left;font-size:11px;color:var(--tk-text-2);background:#f5f7fa}.health-details__table td{padding:14px 8px;border-bottom:1px solid var(--tk-border);overflow-wrap:anywhere}
</style>
