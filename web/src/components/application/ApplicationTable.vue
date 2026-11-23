<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TableSort } from 'tdesign-vue-next'
import type { Application, Binding, Cluster, Environment } from '@/types'
import { fmtRelative } from '@/utils/format'
const props = defineProps<{ rows: Application[]; clusters: Cluster[]; environments: Environment[]; bindings: Record<string, Binding[]> }>()
const emit = defineEmits<{ clone: [app: Application]; delete: [app: Application] }>()
const sort = ref<TableSort>({ sortBy: 'name', descending: false })
const orderedRows = computed(() => {
  const current = Array.isArray(sort.value) ? sort.value[0] : sort.value
  if (!current) return props.rows
  return [...props.rows].sort((a, b) => String(a[current.sortBy as keyof Application] ?? '').localeCompare(String(b[current.sortBy as keyof Application] ?? ''), undefined, { numeric: true }) * (current.descending ? -1 : 1))
})
const columns = [
  { colKey: 'name', title: 'APP NAME', width: 280, sorter: true },
  { colKey: 'environment', title: 'ENVIRONMENT', width: 200 },
  { colKey: 'cluster', title: 'CLUSTER', width: 180 },
  { colKey: 'namespace', title: 'NAMESPACE', width: 170 },
  { colKey: 'lastDeployedAt', title: 'LAST DEPLOYED AT', width: 180, sorter: true },
  { colKey: 'ops', title: '', width: 76 },
]
function envName(id: string): string { return props.environments.find((item) => item.id === id)?.name ?? id }
function clusterName(id: string): string { return props.clusters.find((item) => item.id === id)?.name ?? id }
function envLink(row: Application, binding: Binding) { return { name: 'app-resources', params: { projectId: row.projectId, appId: row.id }, query: { env: binding.id } } }
</script>
<template>
  <t-table :data="orderedRows" :columns="columns" row-key="id" hover :sort="sort" :show-sort-column-bg-color="false" @sort-change="sort = $event">
    <template #name="{ row }"><div class="app-name"><t-icon name="app" size="18px" /><router-link :to="{ name:'app-overview',params:{projectId:row.projectId,appId:row.id} }">{{ row.name }}</router-link></div></template>
    <template #environment="{ row }"><div class="app-environments"><router-link v-for="binding in bindings[row.id] ?? []" :key="binding.id" :to="envLink(row, binding)">{{ envName(binding.environmentId) }}</router-link><span v-if="!bindings[row.id]?.length" class="u-muted">Not configured</span></div></template>
    <template #cluster="{ row }"><div class="app-environments"><span v-for="binding in bindings[row.id] ?? []" :key="binding.id">{{ clusterName(binding.target.clusterId) }}</span><span v-if="!bindings[row.id]?.length">—</span></div></template>
    <template #namespace="{ row }"><div class="app-environments"><span v-for="binding in bindings[row.id] ?? []" :key="binding.id">{{ binding.target.namespace }}</span><span v-if="!bindings[row.id]?.length">—</span></div></template>
    <template #lastDeployedAt="{ row }">{{ row.lastDeployedAt ? fmtRelative(row.lastDeployedAt) : '—' }}</template>
    <template #ops="{ row }"><div class="app-row-actions"><router-link :to="{name:'config-git',params:{projectId:row.projectId,appId:row.id}}" title="Configurations"><t-icon name="setting" /></router-link><t-dropdown trigger="click" placement="bottom-right" :options="[{content:'克隆应用',value:'clone'},{content:'删除应用',value:'delete',theme:'error'}]" @click="$event.value === 'clone' ? emit('clone', row) : emit('delete', row)"><t-button variant="text" size="small" shape="square" :aria-label="`${row.name} 更多操作`"><t-icon name="more" /></t-button></t-dropdown></div></template>
    <template #empty><slot name="empty">没有匹配的应用</slot></template>
  </t-table>
</template>
<style scoped>
.app-name{display:flex;align-items:center;gap:20px}.app-name>.t-icon{color:var(--tk-primary)}.app-name a{font-weight:500}.app-project{margin:6px 0 0 28px;font-size:11px;color:var(--tk-text-3)}.app-environments{display:flex;flex-direction:column;gap:0;line-height:24px}.app-row-actions{display:flex;align-items:center;gap:8px}.app-row-actions>a{display:flex;color:var(--tk-text-2)}:deep(.t-table td){padding:10px 20px!important;border-bottom-color:#edf1f5}:deep(.t-table th:first-child){padding-left:60px!important}:deep(.t-table th){padding:10px 20px!important}:deep(.t-table__content){overflow:auto}
</style>
