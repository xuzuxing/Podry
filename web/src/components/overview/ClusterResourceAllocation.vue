<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { InfraClusterRow } from '@/composables/useInfraManagementOverview'
import { parseQuantity, percent } from '@/utils/managementOverview'
import OverviewPanel from './OverviewPanel.vue'

const props = defineProps<{ rows: InfraClusterRow[] }>()
const sortBy = shallowRef('name')
const direction = shallowRef('asc')
const page = shallowRef(1)
const pageSize = shallowRef(5)
const options = [{ value: 'name', label: '集群名称' }, { value: 'cpuCapacity', label: 'CPU 容量' }, { value: 'cpuLimit', label: 'CPU 限制比例' }, { value: 'cpuUsage', label: 'CPU 使用率' }, { value: 'cpuRequest', label: 'CPU 请求比例' }, { value: 'memoryCapacity', label: '内存容量' }]
const rows = computed(() => props.rows.map(({ cluster, overview }) => ({
  id: cluster.id, name: cluster.name,
  metrics: (['cpu', 'memory'] as const).map(kind => ({ kind, capacity: overview?.[kind].capacity ?? (kind === 'cpu' ? cluster.cpuCapacity : cluster.memoryCapacity) ?? '—', usage: percent(overview?.[kind].usage), request: percent(overview?.[kind].request), limit: percent(overview?.[kind].limit) })),
  cpuCapacity: parseQuantity(overview?.cpu.capacity ?? cluster.cpuCapacity, 'cpu'), cpuUsage: percent(overview?.cpu.usage), cpuRequest: percent(overview?.cpu.request), cpuLimit: percent(overview?.cpu.limit), memoryCapacity: parseQuantity(overview?.memory.capacity ?? cluster.memoryCapacity, 'memory'),
})).sort((a, b) => {
  if (sortBy.value === 'name') return a.name.localeCompare(b.name, 'zh-CN') * (direction.value === 'asc' ? 1 : -1)
  const key = sortBy.value as 'cpuCapacity' | 'cpuUsage' | 'cpuRequest' | 'cpuLimit' | 'memoryCapacity'
  const av = a[key], bv = b[key]
  if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1
  return (av - bv) * (direction.value === 'asc' ? 1 : -1)
}))
const visible = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize.value)))
watch(sortBy, value => { direction.value = value === 'name' ? 'asc' : 'desc' })
watch([sortBy, direction, pageSize, () => props.rows], () => { page.value = 1 })
const formatPercent = (value: number | null) => value === null ? '—' : `${value}%`
</script>

<template>
  <OverviewPanel title="集群容量与资源分配" class="cluster-allocation">
    <template #actions><span class="cluster-allocation__sort-label">排序：</span><select v-model="sortBy" class="overview-select" aria-label="资源分配排序字段"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select><select v-model="direction" class="overview-select" aria-label="资源分配排序方向"><option value="asc">{{ sortBy === 'name' ? '名称正序' : '数值从低到高' }}</option><option value="desc">{{ sortBy === 'name' ? '名称倒序' : '数值从高到低' }}</option></select></template>
    <div class="cluster-allocation__scroll"><table class="cluster-allocation__table"><thead><tr><th>集群名称</th><th>CPU</th><th>内存</th></tr></thead><tbody><tr v-for="row in visible" :key="row.id"><td><router-link :to="{ name: 'cluster-workspace', params: { clusterId: row.id } }">{{ row.name }}</router-link></td><td v-for="metric in row.metrics" :key="metric.kind">
      <div class="cluster-allocation__track" :class="`cluster-allocation__track--${metric.kind}`" :title="`使用率：${formatPercent(metric.usage)}；请求比例： ${formatPercent(metric.request)}`"><span v-if="metric.usage !== null" class="cluster-allocation__fill" :style="{ width: `${Math.min(100, metric.usage)}%` }" /><i v-if="metric.request !== null" class="cluster-allocation__request" :style="{ left: `calc(${Math.min(100, metric.request)}% - 1px)` }" /></div>
      <dl class="cluster-allocation__values"><div><dt>容量</dt><dd>{{ metric.capacity }}</dd></div><div><dt>使用率</dt><dd>{{ formatPercent(metric.usage) }}</dd></div><div><dt>请求比例</dt><dd>{{ formatPercent(metric.request) }}</dd></div><div><dt>限制比例</dt><dd>{{ formatPercent(metric.limit) }}</dd></div></dl>
    </td></tr></tbody></table></div>
    <template #footer><span>色条：实际使用率 · 黑线：资源请求比例</span><div v-if="rows.length > 5" class="overview-pagination"><select v-model.number="pageSize" class="overview-select" aria-label="资源分配每页条数"><option :value="5">5 条/页</option><option :value="10">10 条/页</option><option :value="20">20 条/页</option></select><button :disabled="page === 1" aria-label="资源分配上一页" @click="page--">‹</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" aria-label="资源分配下一页" @click="page++">›</button></div></template>
  </OverviewPanel>
</template>

<style scoped>
.cluster-allocation__sort-label{font-size:12px;color:var(--tk-text-2)}.cluster-allocation__scroll{overflow:auto}.cluster-allocation__table{width:100%;min-width:740px;table-layout:fixed;border-collapse:collapse}.cluster-allocation__table th{padding:9px 16px;background:#fafbfc;text-align:left;color:var(--tk-text-2);font-size:11px;line-height:20px;font-weight:600;border-bottom:1px solid #edf0f4}.cluster-allocation__table th:first-child{width:170px}.cluster-allocation__table td{padding:16px;vertical-align:top;border-bottom:1px solid #edf0f4;font-size:13px;overflow-wrap:anywhere}.cluster-allocation__table tr:last-child td{border-bottom:0}.cluster-allocation__table tbody tr:hover{background:#fafbfc}.cluster-allocation__track{position:relative;height:8px;border-radius:4px;overflow:hidden;background:#edf0f4}.cluster-allocation__fill{display:block;height:100%;background:#0080ff;border-radius:4px}.cluster-allocation__track--cpu .cluster-allocation__fill{background:#49b47c}.cluster-allocation__request{position:absolute;top:0;width:2px;height:100%;background:#384a5c}.cluster-allocation__values{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:10px 0 0}.cluster-allocation__values>div+div{border-left:1px solid var(--tk-border);padding-left:8px}.cluster-allocation__values dt{font-size:10px;color:var(--tk-text-3);line-height:18px}.cluster-allocation__values dd{margin:0;font-size:12px;color:var(--tk-text);font-variant-numeric:tabular-nums}
</style>
