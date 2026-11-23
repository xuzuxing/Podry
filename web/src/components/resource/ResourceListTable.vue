<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { TableSort } from 'tdesign-vue-next'
import type { ResourceRow, ResourceColumn } from './listTypes'
import type { ResourceTabKey } from '@/stores/resourceTabs'
import ResourceColumnSelector from './ResourceColumnSelector.vue'
import ResourceUsageCell from './ResourceUsageCell.vue'
import ResourceListPagination from './ResourceListPagination.vue'
import { compareResourceRows } from '@/utils/resourceListing'
import { resourcePage, type ResourceListState } from '@/utils/resourceListState'

const props = defineProps<{ rows: ResourceRow[]; columns: ResourceColumn[]; loading: boolean; resource: string; group?: string; state: ResourceListState; selectionKey: string }>()
const emit = defineEmits<{
  open: [row: ResourceRow, tab?: ResourceTabKey]
  action: [action: string, rows: ResourceRow[]]
  node: [name: string]
  sort: [value: TableSort]
  page: [value: number]
  size: [value: number]
}>()
const selected = ref<Array<string | number>>([])
const tableRoot = useTemplateRef<HTMLElement>('tableRoot')
const sort = computed(() => ({ sortBy: props.state.sortBy, descending: props.state.sortOrder === 'DESC' }))
const visibleColumns = ref<string[]>([])
const orderedRows = computed(() => resourcePage(props.rows, props.state, (a, b) => compareResourceRows(a, b, props.state.sortBy, props.state.sortOrder === 'DESC')))
const tableColumns = computed(() => [
  { colKey: 'row-select', type: 'multiple' as const, width: 40 },
  ...props.columns.filter((col) => col.key !== 'ops' && visibleColumns.value.includes(col.key)).map((col) => ({ colKey: col.key, title: col.label, width: col.width, sorter: true, ellipsis: true, fixed: col.key === 'name' ? 'left' as const : undefined })),
  { colKey: 'ops', title: '', width: 44, fixed: 'right' as const },
])
const selectedRows = computed(() => orderedRows.value.filter((row) => selected.value.includes(row.id)))
function setColumns(keys: string[]): void { visibleColumns.value = keys }
watch([() => props.resource, () => props.group, () => props.columns], () => { selected.value = []; visibleColumns.value = props.columns.filter((col) => col.key !== 'ops').map((col) => col.key) }, { immediate: true })
watch(() => props.selectionKey, () => { selected.value = [] })
watch(() => props.selectionKey, () => { const content = tableRoot.value?.querySelector('.t-table__content'); if (content) content.scrollTop = 0 }, { flush: 'post' })
watch(orderedRows, () => { selected.value = selected.value.filter((id) => orderedRows.value.some((row) => row.id === id)) })
function menu(row: ResourceRow): Array<{ content: string; value: string; theme?: 'error' }> {
  const options: Array<{ content: string; value: string; theme?: 'error' }> = [{ content: row.kind === 'Node' && !row.group ? '查看节点详情' : 'Manifest', value: 'manifest' }, { content: 'Events', value: 'events' }]
  if (row.kind === 'Pod' && !row.group) options.push({ content: 'Logs', value: 'logs' }, { content: 'Terminal', value: 'terminal' })
  if (row.group === 'apps' && ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(row.kind)) options.push({ content: '重启工作负载', value: 'restart' })
  if (row.group === 'apps' && ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(row.kind)) options.push({ content: '扩缩容', value: 'scale' })
  if (row.kind === 'Node' && !row.group) options.push({ content: row.status.includes('SchedulingDisabled') ? 'Uncordon' : 'Cordon', value: row.status.includes('SchedulingDisabled') ? 'uncordon' : 'cordon' }, { content: 'Drain', value: 'drain' }, { content: 'Edit taints', value: 'taints' })
  options.push({ content: '删除资源', value: 'delete', theme: 'error' })
  return options
}
function action(value: string, row: ResourceRow): void {
  if (['manifest', 'events', 'logs', 'terminal'].includes(value)) emit('open', row, value as ResourceTabKey)
  else emit('action', value, [row])
}
async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); void MessagePlugin.success('资源名称已复制') }
  catch { void MessagePlugin.error('复制失败') }
}
function onTableKey(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null
  const row = target?.closest('tbody tr')
  if (!row || !target || target.closest('input, textarea, [role="menu"]')) return
  if (event.shiftKey && event.key === 'F10') {
    event.preventDefault()
    const menu = row.querySelector<HTMLButtonElement>('.resource-row-menu')
    menu?.focus(); menu?.click()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const names = [...row.closest('tbody')!.querySelectorAll<HTMLButtonElement>('.resource-name .resource-name__link')]
  const current = names.findIndex(button => button.closest('tr') === row)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : Math.max(0, Math.min(names.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
  event.preventDefault(); names[next]?.focus()
}
</script>

<template>
  <div ref="tableRoot" class="resource-table" @keydown="onTableKey">
    <div v-if="$slots.toolbar" class="resource-table__filter-toolbar"><slot name="toolbar" :visible-columns="visibleColumns" :set-columns="setColumns" /></div>
    <div class="resource-table__tools">
      <template v-if="selected.length"><span>已选择 {{ selected.length }} 项</span><t-button theme="danger" variant="text" size="small" @click="emit('action', 'delete', selectedRows)"><template #icon><t-icon name="delete" /></template>删除</t-button><t-button variant="text" size="small" @click="selected = []">取消选择</t-button></template>
      <span v-else class="u-dim">{{ rows.length }} 个资源</span>
      <span v-if="!$slots.toolbar" class="resource-table__column-control"><ResourceColumnSelector :key="`${group}/${resource}`" :columns="columns" :value="visibleColumns" @change="visibleColumns = $event" /></span>
    </div>
    <t-table :data="orderedRows" :columns="tableColumns" row-key="id" size="medium" hover :loading="loading" :selected-row-keys="selected" :sort="sort" :show-sort-column-bg-color="false" @sort-change="emit('sort', $event)" @select-change="selected = $event">
      <template #name="{ row }"><div class="resource-name"><button class="resource-name__link" @keydown.enter.prevent="emit('open', row)" @click="emit('open', row)">{{ row.name }}</button><t-button class="resource-name__copy" size="small" variant="text" shape="square" title="复制资源名称" @click.stop="copy(row.name)"><t-icon name="copy" size="13px" /></t-button></div></template>
      <template #node="{ row }"><button v-if="row.fields.node && row.fields.node !== '—'" class="resource-name__link" @click="emit('node', row.fields.node)">{{ row.fields.node }}</button><span v-else>—</span></template>
      <template #cpu="{ row }"><ResourceUsageCell :percentage="row.fields.cpu" :absolute="row.fields.cpuAbsolute" :allocatable="row.fields.cpuAllocatable" tone="cpu" /></template>
      <template #memory="{ row }"><ResourceUsageCell :percentage="row.fields.memory" :absolute="row.fields.memoryAbsolute" :allocatable="row.fields.memoryAllocatable" tone="memory" /></template>
      <template #errorCount="{ row }"><span :class="{ 'resource-state bad': Number(row.fields.errorCount) > 0 }">{{ row.fields.errorCount }}</span></template>
      <template #status="{ row }"><span :class="['resource-state', /Running|Available|Active|Ready|Complete|Succeeded|Bound|Established/.test(row.status) && !/NotReady|NotEstablished/.test(row.status) ? 'ok' : /Error|Failed|BackOff|NotReady|NotEstablished/.test(row.status) ? 'bad' : '']">{{ row.status.replace(', SchedulingDisabled', '') }}</span><span v-if="row.status.includes('SchedulingDisabled')" class="resource-state bad"> · SchedulingDisabled</span></template>
      <template v-for="col in columns.filter((item) => !['name', 'status', 'ops', 'node', 'cpu', 'memory', 'errorCount'].includes(item.key))" :key="col.key" #[col.key]="{ row }">{{ col.key === 'namespace' ? (row.namespace === '_cluster' ? '—' : row.namespace) : col.key === 'age' ? row.age : row.fields[col.key] ?? '—' }}</template>
      <template #ops="{ row }"><t-dropdown trigger="click" placement="bottom-right" :options="menu(row)" @click="action(String($event.value), row)"><t-button class="resource-row-menu" size="small" variant="text" shape="square" :aria-label="`${row.name} 更多操作`"><t-icon name="more" /></t-button></t-dropdown></template>
      <template #empty><div class="resource-table__empty">没有匹配的资源，可调整命名空间或搜索条件。</div></template>
    </t-table>
    <ResourceListPagination :total="rows.length" :page="state.pageNumber" :page-size="state.pageSize" :nodes="resource === 'nodes' && !group" :loading="loading" @page="emit('page', $event)" @size="emit('size', $event)" />
  </div>
</template>

<style scoped>
.resource-table__tools{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 16px;border-bottom:1px solid var(--tk-border);font-size:12px}.resource-table__columns{margin-left:auto}.resource-columns{display:flex;flex-direction:column;gap:12px;width:200px;padding:12px}.resource-columns :deep(.t-checkbox-group){display:flex;flex-direction:column;gap:8px}.resource-name{display:flex;align-items:center;gap:6px;min-width:0}.resource-name__link{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tk-primary);font:inherit;background:none;border:0;padding:0;cursor:pointer}.resource-name__link:hover{text-decoration:underline}.resource-name__copy{opacity:0}.resource-name:hover .resource-name__copy,.resource-name__copy:focus-visible{opacity:1}.resource-state.ok{color:#00b889}.resource-state.bad{color:#f33e5b}.resource-table__empty{padding:48px;color:var(--tk-text-3)}
.resource-table :deep(.t-table td){height:42px;border-color:#edf1f5}.resource-table :deep(.t-table th){height:40px}.resource-table :deep(.t-table__content){overflow:auto}
.resource-table__column-control{margin-left:auto}.resource-table{min-width:0}
.resource-table{display:flex;flex:1;flex-direction:column;min-height:0}
.resource-table__filter-toolbar,.resource-table__tools{flex:none}
.resource-table :deep(.t-table){display:flex;flex:1;flex-direction:column;min-height:0}
.resource-table :deep(.t-table__content){flex:1;min-height:0}
.resource-table :deep(th){position:sticky;top:0;z-index:1}
</style>
