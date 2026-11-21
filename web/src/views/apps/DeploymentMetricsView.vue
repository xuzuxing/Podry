<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { listBindings, listBuilds, listDeployments, listEnvironments } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import type { Binding, Build, Deployment, Environment } from '@/types'
import { fmtRelative, fmtTime } from '@/utils/format'

const route = useRoute()
const appId = computed(() => String(route.params.appId ?? ''))

const loading = ref(true)
const error = ref('')
const deployments = ref<Deployment[]>([])
const builds = ref<Build[]>([])
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])

const envFilter = ref('')
const rangeDays = ref(30)

const rangeOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
]

const envOptions = computed(() => [
  { label: '全部环境', value: '' },
  ...bindings.value.map((binding) => ({
    label: environmentName(binding.environmentId),
    value: binding.id,
  })),
])

function environmentName(environmentId: string): string {
  return environments.value.find((item) => item.id === environmentId)?.name ?? environmentId
}

function bindingEnvName(bindingId: string): string {
  const binding = bindings.value.find((item) => item.id === bindingId)
  return binding ? environmentName(binding.environmentId) : '—'
}

const cutoff = computed(() => Date.now() - rangeDays.value * 24 * 60 * 60 * 1000)

const filtered = computed(() =>
  deployments.value.filter((item) => {
    if (envFilter.value && item.bindingId !== envFilter.value) return false
    return Date.parse(item.createdAt) >= cutoff.value
  }),
)

const succeeded = computed(() => filtered.value.filter((item) => item.status === 'succeeded'))
const failed = computed(() => filtered.value.filter((item) => item.status === 'failed'))

const failureRate = computed(() =>
  filtered.value.length ? Math.round((failed.value.length / filtered.value.length) * 1000) / 10 : 0,
)
const frequency = computed(() => {
  const perDay = filtered.value.length / rangeDays.value
  return perDay >= 1 ? perDay.toFixed(1) : perDay.toFixed(2)
})

const buildsByArtifact = computed(() => {
  const map = new Map<string, Build>()
  builds.value.forEach((build) => {
    if (build.artifactId) map.set(build.artifactId, build)
  })
  return map
})

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} 分钟`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} 小时`
  return `${(hours / 24).toFixed(1)} 天`
}

/** 构建开始 → 发布触发，作为变更前置时间的近似值。 */
const leadTime = computed(() => {
  const values: number[] = []
  succeeded.value.forEach((deployment) => {
    const build = buildsByArtifact.value.get(deployment.artifactId)
    if (!build) return
    const delta = Date.parse(deployment.createdAt) - Date.parse(build.createdAt)
    if (delta > 0) values.push(delta / 60000)
  })
  return median(values)
})

/** 同一环境失败后下一次成功发布的时间差，取中位数。 */
const mttr = computed(() => {
  const byBinding = new Map<string, Deployment[]>()
  filtered.value.forEach((item) => {
    const list = byBinding.get(item.bindingId) ?? []
    list.push(item)
    byBinding.set(item.bindingId, list)
  })
  const values: number[] = []
  byBinding.forEach((list) => {
    const sorted = [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    sorted.forEach((item, index) => {
      if (item.status !== 'failed') return
      const next = sorted.slice(index + 1).find((candidate) => candidate.status === 'succeeded')
      if (!next) return
      values.push((Date.parse(next.createdAt) - Date.parse(item.createdAt)) / 60000)
    })
  })
  return median(values)
})

interface DayBucket {
  key: string
  label: string
  success: number
  failed: number
}

const chartDays = computed(() => Math.min(rangeDays.value, 30))
const chart = computed<DayBucket[]>(() => {
  const buckets: DayBucket[] = []
  for (let offset = chartDays.value - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    const key = date.toISOString().slice(0, 10)
    buckets.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, success: 0, failed: 0 })
  }
  const index = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  filtered.value.forEach((item) => {
    const bucket = index.get(item.createdAt.slice(0, 10))
    if (!bucket) return
    if (item.status === 'failed') bucket.failed += 1
    else if (item.status === 'succeeded') bucket.success += 1
  })
  return buckets
})
const chartMax = computed(() => Math.max(1, ...chart.value.map((bucket) => bucket.success + bucket.failed)))

function barHeight(value: number): string {
  return `${Math.round((value / chartMax.value) * 120)}px`
}

interface EnvRow {
  id: string
  name: string
  total: number
  success: number
  failed: number
  successRate: number
  last: string
}

const envRows = computed<EnvRow[]>(() => {
  const rows = new Map<string, EnvRow>()
  filtered.value.forEach((item) => {
    const id = item.bindingId
    const row = rows.get(id) ?? {
      id,
      name: bindingEnvName(id),
      total: 0,
      success: 0,
      failed: 0,
      successRate: 0,
      last: '',
    }
    row.total += 1
    if (item.status === 'succeeded') row.success += 1
    if (item.status === 'failed') row.failed += 1
    if (!row.last || Date.parse(item.createdAt) > Date.parse(row.last)) row.last = item.createdAt
    rows.set(id, row)
  })
  return [...rows.values()]
    .map((row) => ({ ...row, successRate: Math.round((row.success / row.total) * 100) }))
    .sort((a, b) => b.total - a.total)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [page, buildPage, bindingList, envList] = await Promise.all([
      listDeployments(appId.value),
      listBuilds(appId.value),
      listBindings(appId.value),
      listEnvironments(),
    ])
    deployments.value = page.items
    builds.value = buildPage.items
    bindings.value = bindingList
    environments.value = envList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '发布指标加载失败'
  } finally {
    loading.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="metrics">
    <header class="metrics__head">
      <div>
        <h1>发布指标</h1>
        <p>基于发布记录统计部署频率、变更失败率与恢复时间；数据来自当前 mock 发布历史。</p>
      </div>
      <div class="metrics__filters">
        <t-select v-model="envFilter" :options="envOptions" class="metrics__select" size="small" />
        <t-select v-model="rangeDays" :options="rangeOptions" class="metrics__select metrics__select--range" size="small" />
      </div>
    </header>

    <div v-if="loading" class="metrics__state"><t-loading size="small" text="加载发布指标…" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <div class="metrics__cards">
        <section class="metric-card">
          <p class="metric-card__label">部署频率</p>
          <p class="metric-card__value">{{ frequency }}<span>次/天</span></p>
          <p class="metric-card__hint">{{ filtered.length }} 次发布 · 近 {{ rangeDays }} 天</p>
        </section>
        <section class="metric-card">
          <p class="metric-card__label">变更前置时间</p>
          <p class="metric-card__value">{{ fmtDuration(leadTime) }}</p>
          <p class="metric-card__hint">构建开始到发布触发的中位数</p>
        </section>
        <section class="metric-card">
          <p class="metric-card__label">变更失败率</p>
          <p class="metric-card__value" :class="{ 'metric-card__value--bad': failureRate > 15 }">{{ failureRate }}<span>%</span></p>
          <p class="metric-card__hint">{{ failed.length }} 次失败 / {{ filtered.length }} 次发布</p>
        </section>
        <section class="metric-card">
          <p class="metric-card__label">平均恢复时间</p>
          <p class="metric-card__value">{{ fmtDuration(mttr) }}</p>
          <p class="metric-card__hint">失败后下一次成功发布的中位数</p>
        </section>
      </div>

      <section class="metrics__panel">
        <div class="panel-head">
          <span>每日发布</span>
          <span class="panel-head__legend">
            <em class="legend legend--ok" />成功
            <em class="legend legend--bad" />失败
          </span>
        </div>
        <div class="chart">
          <div v-for="bucket in chart" :key="bucket.key" class="chart__col" :title="`${bucket.label}：成功 ${bucket.success}，失败 ${bucket.failed}`">
            <div class="chart__bars">
              <span v-if="bucket.failed > 0" class="chart__bar chart__bar--bad" :style="{ height: barHeight(bucket.failed) }" />
              <span v-if="bucket.success > 0" class="chart__bar chart__bar--ok" :style="{ height: barHeight(bucket.success) }" />
            </div>
            <span class="chart__label">{{ bucket.label }}</span>
          </div>
        </div>
      </section>

      <section class="metrics__panel">
        <div class="panel-head"><span>按环境</span></div>
        <div v-if="!envRows.length" class="metrics__empty">当前筛选范围内没有发布记录。</div>
        <table v-else class="env-table">
          <thead>
            <tr>
              <th>环境</th>
              <th>发布次数</th>
              <th>成功</th>
              <th>失败</th>
              <th>成功率</th>
              <th>最近发布</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in envRows" :key="row.id">
              <td>{{ row.name }}</td>
              <td>{{ row.total }}</td>
              <td>{{ row.success }}</td>
              <td>{{ row.failed }}</td>
              <td>{{ row.successRate }}%</td>
              <td :title="fmtTime(row.last)">{{ fmtRelative(row.last) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.metrics {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 130px);
  padding: 20px 24px;
  background: #fff;
}
.metrics__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.metrics__head h1 {
  margin: 0 0 6px;
  color: #000a14;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.metrics__head p {
  margin: 0;
  color: #596168;
  font-size: 12px;
  line-height: 18px;
}
.metrics__filters {
  display: flex;
  gap: 8px;
}
.metrics__select {
  width: 150px;
}
.metrics__select--range {
  width: 110px;
}
.metrics__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
}
.metrics__cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.metric-card {
  padding: 16px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.metric-card__label {
  margin: 0 0 8px;
  color: #596168;
  font-size: 12px;
}
.metric-card__value {
  margin: 0 0 6px;
  color: #000a14;
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
}
.metric-card__value span {
  margin-left: 4px;
  color: #767d84;
  font-size: 12px;
  font-weight: 400;
}
.metric-card__value--bad {
  color: #f33e3e;
}
.metric-card__hint {
  margin: 0;
  color: #767d84;
  font-size: 11px;
  line-height: 16px;
}
.metrics__panel {
  padding: 16px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
}
.panel-head__legend {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #767d84;
  font-size: 11px;
  font-weight: 400;
}
.legend {
  width: 8px;
  height: 8px;
  border-radius: 1px;
}
.legend--ok {
  background: #1dad70;
}
.legend--bad {
  margin-left: 10px;
  background: #f33e3e;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 160px;
  padding-top: 8px;
  overflow-x: auto;
}
.chart__col {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 22px;
}
.chart__bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 120px;
}
.chart__bar {
  width: 8px;
  border-radius: 1px 1px 0 0;
}
.chart__bar--ok {
  background: #1dad70;
}
.chart__bar--bad {
  background: #f33e3e;
}
.chart__label {
  color: #767d84;
  font-size: 10px;
  white-space: nowrap;
}
.metrics__empty {
  padding: 24px;
  color: #767d84;
  font-size: 12px;
  text-align: center;
}
.env-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.env-table th {
  padding: 8px 12px;
  color: #767d84;
  font-weight: 500;
  text-align: left;
  background: #f7fafc;
  border-bottom: 1px solid #e6e9ef;
}
.env-table td {
  padding: 10px 12px;
  color: #3b444c;
  border-bottom: 1px solid #edf1f5;
}
</style>
