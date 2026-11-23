<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Build, Deployment } from '@/types'
import { activityPeriods, formatDuration, inPeriod, periodBounds } from '@/utils/managementOverview'
import type { OverviewPeriod } from '@/utils/managementOverview'
import OverviewPanel from './OverviewPanel.vue'
import OverviewEmptyState from './OverviewEmptyState.vue'

const props = defineProps<{ builds: Build[]; deployments: Deployment[]; now: Date }>()
const period = shallowRef<OverviewPeriod>('month')
const active = shallowRef<'builds' | 'duration' | 'deployments'>('builds')
const hidden = shallowRef<string[]>([])
const builds = computed(() => props.builds.filter(item => inPeriod(item.createdAt, period.value, props.now)))
const deployments = computed(() => props.deployments.filter(item => inPeriod(item.createdAt, period.value, props.now)))
const duration = (build: Build): number | null => {
  const end = build.finishedAt ? Date.parse(build.finishedAt) : NaN
  const minutes = (end - Date.parse(build.createdAt)) / 60000
  return Number.isFinite(minutes) && minutes >= 0 && end <= props.now.getTime() ? minutes : null
}
const average = (records: Build[]): number | null => {
  const values = records.map(duration).filter((value): value is number => value !== null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}
const tabs = computed(() => [
  { id: 'builds' as const, title: '构建触发总次数', value: builds.value.length.toLocaleString() },
  { id: 'duration' as const, title: '平均构建耗时', value: formatDuration(average(builds.value)) },
  { id: 'deployments' as const, title: '部署触发总次数', value: deployments.value.length.toLocaleString() },
])
const buckets = computed(() => {
  const bounds = periodBounds(period.value, props.now)
  const count = period.value === 'today' ? props.now.getHours() + 1 : bounds.days
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(bounds.start)
    const next = new Date(bounds.start)
    if (period.value === 'today') { date.setHours(index); next.setHours(index + 1) }
    else { date.setDate(date.getDate() + index); next.setDate(next.getDate() + index + 1) }
    const records = active.value === 'deployments' ? deployments.value : builds.value
    const selected = records.filter(item => Date.parse(item.createdAt) >= date.getTime() && Date.parse(item.createdAt) < next.getTime())
    return { label: period.value === 'today' ? `${String(index).padStart(2, '0')}:00` : `${date.getMonth() + 1}月${date.getDate()}日`, total: selected.length, failed: selected.filter(item => item.status === 'failed').length, successful: selected.filter(item => item.status === 'succeeded').length, average: average(builds.value.filter(item => Date.parse(item.createdAt) >= date.getTime() && Date.parse(item.createdAt) < next.getTime())) }
  })
})
const datasets = computed(() => active.value === 'duration'
  ? [{ label: '平均构建耗时（分钟）', key: 'average' as const, color: '#0080ff' }]
  : [{ label: '失败', key: 'failed' as const, color: '#ef716b' }, { label: '成功', key: 'successful' as const, color: '#54b987' }, { label: active.value === 'deployments' ? '部署触发次数' : '构建触发次数', key: 'total' as const, color: '#0080ff' }])
const max = computed(() => Math.max(1, ...datasets.value.filter(item => !hidden.value.includes(item.label)).flatMap(item => buckets.value.map(bucket => bucket[item.key] ?? 0))))
const x = (index: number) => 60 + index / Math.max(1, buckets.value.length - 1) * 900
const y = (value: number) => 210 - value / max.value * 175
const series = computed(() => datasets.value.filter(item => !hidden.value.includes(item.label)).map(item => {
  let connected = false
  const path = buckets.value.map((bucket, index) => {
    const value = bucket[item.key]
    if (value === null) { connected = false; return '' }
    const command = connected ? 'L' : 'M'; connected = true
    return `${command}${x(index)},${y(value)}`
  }).join(' ')
  return { ...item, path, points: buckets.value.flatMap((bucket, index) => bucket[item.key] === null ? [] : [{ x: x(index), y: y(bucket[item.key]!), label: bucket.label, value: bucket[item.key]! }]) }
}))
const hasData = computed(() => active.value === 'deployments' ? deployments.value.length > 0 : active.value === 'duration' ? average(builds.value) !== null : builds.value.length > 0)
function toggle(label: string): void { hidden.value = hidden.value.includes(label) ? hidden.value.filter(item => item !== label) : [...hidden.value, label] }
</script>

<template>
  <OverviewPanel title="触发次数与构建耗时" class="activity-chart">
    <template #actions><select v-model="period" class="overview-select" aria-label="构建与部署时间范围"><option v-for="option in activityPeriods" :key="option.value" :value="option.value">{{ option.label }}</option></select></template>
    <template #tabs><div class="activity-chart__tabs" role="tablist" aria-label="构建与部署活动"><button v-for="tab in tabs" :key="tab.id" :id="`activity-tab-${tab.id}`" type="button" role="tab" aria-controls="activity-chart-panel" :aria-selected="active === tab.id" @click="active = tab.id"><span>{{ tab.title }}</span><strong>{{ tab.value }}</strong></button></div></template>
    <div id="activity-chart-panel" role="tabpanel" :aria-labelledby="`activity-tab-${active}`">
      <div v-if="hasData" class="activity-chart__body">
        <span class="activity-chart__axis-title">{{ active === 'duration' ? '平均构建耗时（分钟）' : active === 'builds' ? '构建触发次数' : '部署触发次数' }}</span>
        <svg viewBox="0 0 1000 250" role="img" :aria-label="`${tabs.find(tab => tab.id === active)?.title}趋势`">
          <g v-for="index in 5" :key="index"><line x1="60" x2="960" :y1="y((index - 1) * max / 4)" :y2="y((index - 1) * max / 4)" stroke="#e9edf2" /><text x="48" :y="y((index - 1) * max / 4) + 4" text-anchor="end">{{ Number(((index - 1) * max / 4).toFixed(1)) }}</text></g>
          <g v-for="item in series" :key="item.label"><path :d="item.path" fill="none" :stroke="item.color" stroke-width="2" vector-effect="non-scaling-stroke" /><circle v-for="point in item.points" :key="point.label" :cx="point.x" :cy="point.y" r="3" :fill="item.color"><title>{{ point.label }} · {{ item.label }}: {{ Number(point.value.toFixed(2)) }}</title></circle></g>
          <template v-for="(bucket, index) in buckets" :key="bucket.label"><text v-if="index % Math.max(1, Math.ceil(buckets.length / 10)) === 0 || index === buckets.length - 1" :x="x(index)" y="237" text-anchor="middle">{{ bucket.label }}</text></template>
        </svg>
        <div class="activity-chart__legend"><button v-for="item in datasets" :key="item.label" type="button" :aria-pressed="!hidden.includes(item.label)" @click="toggle(item.label)"><span :style="{ background: item.color }" />{{ item.label }}</button></div>
      </div>
      <OverviewEmptyState v-else :title="active === 'duration' ? '暂无已完成的构建' : active === 'builds' ? '暂无构建触发记录' : '暂无部署触发记录'" description="所选时间范围内暂无记录。" />
    </div>
  </OverviewPanel>
</template>

<style scoped>
.activity-chart__tabs{display:flex;border-bottom:1px solid var(--tk-border)}.activity-chart__tabs button{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:170px;padding:12px 20px;border:0;border-right:1px solid var(--tk-border);border-bottom:2px solid transparent;background:#fff;color:var(--tk-text);font:inherit;font-size:13px;cursor:pointer}.activity-chart__tabs button[aria-selected=true]{border-bottom-color:var(--tk-primary);background:#fafcfe}.activity-chart__tabs strong{font-size:20px;line-height:30px;font-weight:600;font-variant-numeric:tabular-nums}.activity-chart__body{padding:16px 16px 12px}.activity-chart__axis-title{color:var(--tk-text-2);font-size:11px}.activity-chart svg{width:100%;height:260px;overflow:visible}.activity-chart svg text{font-size:11px;fill:var(--tk-text-3)}.activity-chart circle:hover{r:5}.activity-chart__legend{display:flex;justify-content:center;gap:20px}.activity-chart__legend button{display:flex;align-items:center;gap:6px;border:0;background:none;font:inherit;font-size:12px;color:var(--tk-text-2);cursor:pointer}.activity-chart__legend button[aria-pressed=false]{opacity:.4;text-decoration:line-through}.activity-chart__legend button span{display:block;width:9px;height:9px;border-radius:2px}
</style>
