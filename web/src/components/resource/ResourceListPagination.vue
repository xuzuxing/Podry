<script setup lang="ts">
import { computed } from 'vue'
import { lastResourcePage, NODE_PAGE_SIZES, RESOURCE_PAGE_SIZES } from '@/utils/resourceListState'
const props = defineProps<{ total: number; page: number; pageSize: number; nodes?: boolean; loading?: boolean }>()
const emit = defineEmits<{ page: [value: number]; size: [value: number] }>()
const sizes = computed(() => [...new Set([...(props.nodes ? NODE_PAGE_SIZES : RESOURCE_PAGE_SIZES), props.pageSize])].sort((a, b) => a - b).map(value => ({ label: String(value), value })))
const start = computed(() => props.total ? (props.page - 1) * props.pageSize + 1 : 0)
const lastPage = computed(() => lastResourcePage(props.total, props.pageSize))
const pages = computed(() => {
  const first = Math.max(1, Math.min(props.page - 2, lastPage.value - 4))
  return Array.from({ length: Math.min(5, lastPage.value) }, (_, index) => first + index)
})
</script>

<template>
  <div class="resource-pagination" aria-label="资源分页" :aria-busy="loading">
    <span class="resource-pagination__range" aria-live="polite">{{ start }} - {{ Math.min(page * pageSize, total) }} of {{ total }}</span>
    <nav class="resource-pagination__pages" aria-label="资源页码">
      <t-button data-page-prev variant="text" shape="square" size="small" aria-label="上一页" :disabled="loading || page <= 1 || total === 0" @click="emit('page', page - 1)"><t-icon name="chevron-left" /></t-button>
      <t-button v-for="value in pages" :key="value" :data-page="value" :theme="value === page ? 'primary' : 'default'" :variant="value === page ? 'base' : 'text'" shape="square" size="small" :aria-label="`第 ${value} 页`" :aria-current="value === page ? 'page' : undefined" :disabled="loading || total === 0" @click="emit('page', value)">{{ value }}</t-button>
      <t-button data-page-next variant="text" shape="square" size="small" aria-label="下一页" :disabled="loading || page >= lastPage || total === 0" @click="emit('page', page + 1)"><t-icon name="chevron-right" /></t-button>
    </nav>
    <label class="resource-pagination__size"><span>Rows per page</span><t-select :value="pageSize" :options="sizes" size="small" :disabled="loading" aria-label="每页资源数" @change="emit('size', Number($event))" /></label>
  </div>
</template>

<style scoped>
.resource-pagination{display:flex;flex:none;align-items:center;justify-content:space-between;gap:16px;min-height:48px;padding:8px 16px;border-top:1px solid var(--tk-border);background:#fff;font-size:12px;color:var(--tk-text-2)}
.resource-pagination__range{white-space:nowrap;font-variant-numeric:tabular-nums}.resource-pagination__size{display:flex;align-items:center;gap:8px;white-space:nowrap}.resource-pagination__size :deep(.t-select__wrap){width:72px}.resource-pagination__pages{display:flex;align-items:center;gap:4px}
@media(max-width:1100px){.resource-pagination{flex-wrap:wrap;gap:8px}.resource-pagination__size{margin-left:auto}}
</style>
