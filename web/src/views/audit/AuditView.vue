<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listAuditEvents } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import FilterBar from '@/components/FilterBar.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { AuditEvent } from '@/types'
import { fmtTime } from '@/utils/format'

const events = ref<AuditEvent[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const action = ref('all')
const result = ref('all')

const columns = [
  { colKey: 'createdAt', title: '时间', width: 150 },
  { colKey: 'actorName', title: '操作人', width: 110 },
  { colKey: 'action', title: '动作', width: 160 },
  { colKey: 'target', title: '目标', width: 260 },
  { colKey: 'result', title: '结果', width: 100 },
]

const actionOptions = [
  { label: '全部动作', value: 'all' },
  { label: 'deploy.trigger', value: 'deploy.trigger' },
  { label: 'build.trigger', value: 'build.trigger' },
  { label: 'config.save', value: 'config.save' },
  { label: 'resource.delete', value: 'resource.delete' },
  { label: 'secret.reveal', value: 'secret.reveal' },
  { label: 'app.create', value: 'app.create' },
  { label: 'workflow.save', value: 'workflow.save' },
  { label: 'cluster.connect', value: 'cluster.connect' },
  { label: 'auth.login', value: 'auth.login' },
]

const resultOptions = [
  { label: '全部结果', value: 'all' },
  { label: '成功', value: 'succeeded' },
  { label: '失败', value: 'failed' },
  { label: '拒绝', value: 'denied' },
  { label: '待核对', value: 'unknown' },
]

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return events.value.filter((event) => {
    if (action.value !== 'all' && event.action !== action.value) return false
    if (result.value !== 'all' && event.result !== result.value) return false
    if (!kw) return true
    return (
      event.actorName.toLowerCase().includes(kw) ||
      event.action.toLowerCase().includes(kw) ||
      event.target.toLowerCase().includes(kw)
    )
  })
})

const stats = computed(() => ({
  total: rows.value.length,
  succeeded: rows.value.filter((event) => event.result === 'succeeded').length,
  failed: rows.value.filter((event) => event.result === 'failed' || event.result === 'denied').length,
  unknown: rows.value.filter((event) => event.result === 'unknown').length,
}))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    events.value = await listAuditEvents()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作记录加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="audit">
    <PageHeader title="操作记录" description="配置修改、构建、发布、资源操作与拒绝记录，用于追溯谁在何时改动了什么。" />

    <div class="audit__metrics">
      <div class="tk-metric">
        <span class="tk-metric__value">{{ stats.total }}</span>
        <span class="tk-metric__label">总数</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value">{{ stats.succeeded }}</span>
        <span class="tk-metric__label">成功</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value">{{ stats.failed }}</span>
        <span class="tk-metric__label">失败 / 拒绝</span>
      </div>
      <div class="tk-metric">
        <span class="tk-metric__value">{{ stats.unknown }}</span>
        <span class="tk-metric__label">待核对</span>
      </div>
    </div>

    <FilterBar v-model:keyword="keyword" placeholder="按操作人、动作或目标搜索">
      <template #extra>
        <t-select v-model="action" :options="actionOptions" class="audit__select" />
        <t-select v-model="result" :options="resultOptions" class="audit__select" />
      </template>
      <template #actions>
        <t-button size="small" variant="outline" @click="load">
          <template #icon>
            <t-icon name="refresh" />
          </template>
          刷新
        </t-button>
      </template>
    </FilterBar>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <t-table row-key="id" :data="rows" :columns="columns" size="small" hover>
        <template #createdAt="{ row }">
          <span class="u-mono">{{ fmtTime(row.createdAt) }}</span>
        </template>
        <template #actorName="{ row }">{{ row.actorName }}</template>
        <template #action="{ row }">
          <span class="u-mono">{{ row.action }}</span>
        </template>
        <template #target="{ row }">
          <span class="u-muted">{{ row.target }}</span>
        </template>
        <template #result="{ row }">
          <StatusTag kind="audit" :value="row.result" />
        </template>
        <template #empty>
          <EmptyState title="没有匹配的操作记录" description="调整关键字、动作或结果筛选后重试。" icon="history" compact />
        </template>
      </t-table>
    </t-loading>

    <p class="audit__foot">结果包含「已受理」「成功」「失败」「被拒绝」「待核对」；拒绝与待核对记录不可删除。</p>
  </div>
</template>

<style scoped>
.audit__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}
.audit__select {
  width: 150px;
}
.audit__foot {
  margin: 8px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
</style>
