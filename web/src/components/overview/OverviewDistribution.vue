<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { sortDistribution } from '@/utils/managementOverview'
import type { DistributionRow, OverviewSort } from '@/utils/managementOverview'
import OverviewPanel from './OverviewPanel.vue'
import OverviewEmptyState from './OverviewEmptyState.vue'

const props = withDefaults(defineProps<{ title: string; rows: DistributionRow[]; unit: string; emptyTitle?: string }>(), { emptyTitle: '暂无数据' })
const sort = shallowRef<OverviewSort>('desc')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const sorted = computed(() => sortDistribution(props.rows, sort.value))
const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize.value)))
const visible = computed(() => sorted.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const max = computed(() => Math.max(1, ...props.rows.map(row => row.value)))
const ticks = computed(() => Array.from({ length: 5 }, (_, i) => Number((max.value * i / 4).toFixed(1))))
watch([() => props.rows, sort, pageSize], () => { page.value = 1 })
</script>

<template>
  <OverviewPanel :title="title" class="overview-distribution">
    <template #actions><slot name="actions" /><select v-model="sort" class="overview-select" :aria-label="`${title}排序方式`"><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option><option value="az">名称正序</option><option value="za">名称倒序</option></select></template>
    <template #tabs><slot name="tabs" /></template>
    <div v-if="rows.length" class="overview-distribution__chart">
      <div v-for="row in visible" :key="row.id" class="overview-distribution__row">
        <component :is="row.to ? 'router-link' : 'span'" :to="row.to" class="overview-distribution__label" :title="row.label">{{ row.label }}</component>
        <component :is="row.to ? 'router-link' : 'div'" :to="row.to" class="overview-distribution__track" :aria-label="`${row.label}: ${row.value} ${unit}`" :title="`${row.label}: ${row.value} ${unit}`"><span class="overview-distribution__fill" :style="{ width: `${row.value / max * 100}%` }" /></component>
        <strong class="overview-distribution__value">{{ row.value }}</strong>
      </div>
      <div class="overview-distribution__axis"><span v-for="(tick, index) in ticks" :key="index">{{ tick }}</span></div><div class="overview-distribution__unit">{{ unit }}</div>
    </div>
    <OverviewEmptyState v-else :title="emptyTitle" description="所选范围内暂无可展示的数据。" />
    <template v-if="rows.length > 10" #footer><span>第 {{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, rows.length) }} 条，共 {{ rows.length }} 条</span><div class="overview-pagination"><select v-model.number="pageSize" class="overview-select" :aria-label="`${title}每页条数`"><option :value="10">10 条/页</option><option :value="20">20 条/页</option><option :value="50">50 条/页</option></select><button :disabled="page === 1" :aria-label="`${title}上一页`" @click="page--">‹</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" :aria-label="`${title}下一页`" @click="page++">›</button></div></template>
  </OverviewPanel>
</template>

<style scoped>
.overview-distribution__chart{min-height:200px;padding:24px 28px 16px 16px}.overview-distribution__row{display:grid;grid-template-columns:180px minmax(0,1fr) 40px;align-items:center;gap:16px;min-height:40px}.overview-distribution__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;text-align:right}.overview-distribution__track{display:block;height:20px;background:repeating-linear-gradient(to right,#e9edf2 0,#e9edf2 1px,transparent 1px,transparent 25%)}.overview-distribution__fill{display:block;min-width:0;height:100%;background:#0080ff;border-radius:2px}.overview-distribution__value{font-weight:500;font-variant-numeric:tabular-nums}.overview-distribution__axis{display:flex;justify-content:space-between;margin:12px 56px 0 196px;border-top:1px solid var(--tk-border);padding-top:6px;color:var(--tk-text-3);font-size:11px}.overview-distribution__unit{text-align:center;margin:8px 56px 0 196px;color:var(--tk-text-2);font-size:11px}
@media(max-width:900px){.overview-distribution__row{grid-template-columns:130px minmax(0,1fr) 32px}.overview-distribution__axis,.overview-distribution__unit{margin-left:146px}}
</style>
