<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Deployment } from '@/types'
import { inPeriod, periodBounds, relativePeriods } from '@/utils/managementOverview'
import type { OverviewPeriod } from '@/utils/managementOverview'
import OverviewPanel from './OverviewPanel.vue'
import OverviewEmptyState from './OverviewEmptyState.vue'

const props = defineProps<{ deployments: Deployment[]; pipelineCount: number; now: Date }>()
const period = shallowRef<OverviewPeriod>('30')
const selected = computed(() => props.deployments.filter(item => inPeriod(item.createdAt, period.value, props.now)))
const completed = computed(() => selected.value.filter(item => item.status === 'succeeded' || item.status === 'failed'))
const cards = computed(() => [
  { title: '部署频率', value: `${(selected.value.filter(item => item.status === 'succeeded').length / periodBounds(period.value, props.now).days).toFixed(2)} 次/天`, note: '选定时间内成功的生产发布次数 / 日历天数' },
  { title: '平均交付前置时间', value: '—', note: '缺少提交至生产发布完成的关联时间，暂无数据' },
  { title: '变更失败率', value: completed.value.length ? `${Math.round(completed.value.filter(item => item.status === 'failed').length / completed.value.length * 100)}%` : '—', note: '已结束生产发布中的失败比例，不包含构建失败' },
  { title: '平均恢复时间', value: '—', note: '缺少故障与恢复事件，暂无数据' },
])
</script>

<template>
  <OverviewPanel title="DORA 效能指标" class="dora-metrics">
    <template #actions><span v-if="pipelineCount" class="dora-metrics__scope">{{ pipelineCount }} 条生产部署流水线</span><select v-model="period" class="overview-select" aria-label="DORA 指标时间范围"><option v-for="option in relativePeriods" :key="option.value" :value="option.value">{{ option.label }}</option></select></template>
    <template v-if="completed.length">
      <div class="dora-metrics__grid"><article v-for="card in cards" :key="card.title" class="dora-metrics__card"><div class="dora-metrics__summary"><span>{{ card.title }}</span><strong :title="card.note">{{ card.value }}</strong></div><div class="dora-metrics__empty-chart"><span class="dora-metrics__ring" /><span>暂无效能评级数据</span></div></article></div>
      <p class="overview-note">仅统计生产环境。当前数据不包含按流水线的效能评级、提交交付周期及故障恢复事件，因此不生成 卓越 / 高 / 中 / 低 评级。</p>
    </template>
    <OverviewEmptyState v-else title="暂无 DORA 指标" description="所选时间范围内暂无已结束的生产部署记录。" />
  </OverviewPanel>
</template>

<style scoped>
.dora-metrics__scope{font-size:12px;color:var(--tk-text-2)}.dora-metrics__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.dora-metrics__card+.dora-metrics__card{border-left:1px solid var(--tk-border)}.dora-metrics__summary{display:flex;flex-direction:column;gap:4px;min-height:90px;padding:16px;border-bottom:1px solid var(--tk-border);font-size:13px}.dora-metrics__summary strong{font-size:20px;line-height:30px;font-weight:600;font-variant-numeric:tabular-nums}.dora-metrics__empty-chart{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;font-size:11px;color:var(--tk-text-3)}.dora-metrics__ring{width:88px;height:88px;border:16px solid #edf1f5;border-radius:50%}.dora-metrics>.overview-note{border-top:1px solid var(--tk-border)}
@media(max-width:1000px){.dora-metrics__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dora-metrics__card:nth-child(3){border-left:0;border-top:1px solid var(--tk-border)}.dora-metrics__card:nth-child(4){border-top:1px solid var(--tk-border)}}
</style>
