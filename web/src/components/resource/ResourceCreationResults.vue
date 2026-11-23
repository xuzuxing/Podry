<script setup lang="ts">
import type { CreatedResourceRow } from '@/utils/resourceCreation'

defineProps<{ rows: CreatedResourceRow[] }>()
const labels: Record<CreatedResourceRow['status'], string> = { created: '已创建', updated: '已更新', succeeded: '已应用', failed: '失败', skipped: '已跳过' }
</script>

<template>
  <div class="resource-create-results" aria-label="资源应用结果">
    <table>
      <thead><tr><th scope="col">类型</th><th scope="col">名称</th><th scope="col">状态</th><th scope="col">说明</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.index" :data-status="row.status">
          <td :title="row.kind">{{ row.kind }}</td><td>{{ row.name }}</td>
          <td><span class="resource-create-results__status"><t-icon :name="row.status === 'failed' ? 'error-circle-filled' : row.status === 'skipped' ? 'info-circle-filled' : 'check-circle-filled'" />{{ labels[row.status] }}</span></td>
          <td>{{ row.message }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="resource-create-results__empty" role="status">未返回资源处理结果</p>
  </div>
</template>

<style scoped>
.resource-create-results{height:100%;min-height:0;overflow:auto;font-size:13px}.resource-create-results table{width:100%;border-collapse:collapse;table-layout:fixed}.resource-create-results tr{display:grid;grid-template-columns:150px 200px 150px minmax(0,1fr);column-gap:16px;padding:8px 20px}.resource-create-results thead{position:sticky;top:0;z-index:1;background:var(--tk-surface)}.resource-create-results th{font-weight:600;text-align:left;color:var(--tk-text-2)}.resource-create-results thead tr{border-bottom:1px solid var(--tk-border)}.resource-create-results td,.resource-create-results th{min-width:0;line-height:20px;overflow-wrap:anywhere;vertical-align:top}.resource-create-results td:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.resource-create-results tbody tr:hover{background:var(--tk-surface-hover,#f5f7fa)}.resource-create-results__status{display:flex;align-items:flex-start;gap:8px}.resource-create-results__status :deep(.t-icon){flex:none;margin-top:3px;color:#06a35d}.resource-create-results [data-status=failed] :deep(.t-icon){color:#d54941}.resource-create-results [data-status=skipped] :deep(.t-icon){color:#888}.resource-create-results__empty{padding:24px;color:var(--tk-text-3);text-align:center}@media(max-width:700px){.resource-create-results tr{grid-template-columns:minmax(70px,1fr) minmax(100px,1.3fr) 90px minmax(100px,1.3fr);column-gap:8px;padding:8px 12px}.resource-create-results table{min-width:480px}}
</style>
