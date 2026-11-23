<script setup lang="ts">
import { computed } from 'vue'
import type { TableSort } from 'tdesign-vue-next'
import type { ClusterEventRow } from '@/api'
import { fmtRelative } from '@/utils/format'
import { resourcePage, type ResourceListState } from '@/utils/resourceListState'
import EmptyState from '@/components/EmptyState.vue'
import ResourceListPagination from './ResourceListPagination.vue'
const props = defineProps<{ rows: ClusterEventRow[]; state: ResourceListState; loading: boolean }>()
const emit = defineEmits<{ sort: [value: TableSort]; page: [value: number]; size: [value: number] }>()
const lastSeenKey = 'last seen'
const columns = [
  { colKey: 'namespace', title: '命名空间', width: 140 },
  { colKey: 'object', title: '对象', width: 300 },
  { colKey: 'type', title: '类型', width: 90 },
  { colKey: 'reason', title: '原因', width: 170 },
  { colKey: 'message', title: '消息' },
  { colKey: 'count', title: '次数', width: 70 },
  { colKey: lastSeenKey, title: '最近发生', width: 110 },
].map(column => ({ ...column, sorter: true, ellipsis: true }))
const sort = computed(() => ({ sortBy: props.state.sortBy, descending: props.state.sortOrder === 'DESC' }))
const pageRows = computed(() => resourcePage(props.rows.map(row => ({ ...row, object: `${row.kind}/${row.name}` })), props.state, (a, b) => {
  const key = props.state.sortBy
  const value = (row: typeof a) => key === lastSeenKey ? (row.lastSeenAt ? -Date.parse(row.lastSeenAt) : NaN) : row[key as keyof typeof row]
  const left = value(a), right = value(b)
  const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))
  if (empty(left) || empty(right)) return empty(left) === empty(right) ? 0 : empty(left) ? 1 : -1
  return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * (props.state.sortOrder === 'DESC' ? -1 : 1)
}))
</script>

<template>
  <div class="resource-events-table">
    <t-table row-key="id" :data="pageRows" :columns="columns" size="small" hover :loading="loading" :sort="sort" :show-sort-column-bg-color="false" @sort-change="emit('sort', $event)">
      <template #namespace="{ row }"><span class="u-mono">{{ row.namespace }}</span></template>
      <template #object="{ row }"><span class="u-mono">{{ row.object }}</span></template>
      <template #type="{ row }"><t-tag :theme="row.type === 'Warning' ? 'danger' : 'success'" variant="light" size="small">{{ row.type }}</t-tag></template>
      <template #reason="{ row }"><span class="u-mono">{{ row.reason }}</span></template>
      <template #message="{ row }"><span class="u-muted">{{ row.message }}</span></template>
      <template #[lastSeenKey]="{ row }">{{ fmtRelative(row.lastSeenAt) }}</template>
      <template #empty><EmptyState title="没有匹配的集群事件" description="可调整事件类型、命名空间或搜索条件。" icon="history" compact /></template>
    </t-table>
    <ResourceListPagination :total="rows.length" :page="state.pageNumber" :page-size="state.pageSize" :loading="loading" @page="emit('page', $event)" @size="emit('size', $event)" />
  </div>
</template>

<style scoped>
.resource-events-table{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}
.resource-events-table :deep(.t-table){display:flex;flex:1;flex-direction:column;min-height:0}
.resource-events-table :deep(.t-table__content){flex:1;min-height:0;overflow:auto}
.resource-events-table :deep(th){position:sticky;top:0;z-index:1}
</style>
