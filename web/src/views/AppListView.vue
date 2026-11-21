<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listApplications, listBindings, listEnvironments, listProjects } from '@/api'
import type { Application, Binding, Environment, Health, Project } from '@/types'
import { fmtRelative } from '@/utils/format'

const keyword = ref('')
const projectId = ref('')
const health = ref('')
const loading = ref(true)
const error = ref('')
const rows = ref<Application[]>([])
const projects = ref<Project[]>([])
const environments = ref<Environment[]>([])
const bindingsByApp = ref<Record<string, Binding[]>>({})
const filterOpen = ref(false)

const healthOptions = [
  { label: '全部状态', value: '' },
  { label: '健康', value: 'healthy' },
  { label: '异常', value: 'degraded' },
  { label: '进行中', value: 'progressing' },
  { label: '未配置', value: 'unknown' },
]

const projectOptions = computed(() => [
  { label: '全部项目', value: '' },
  ...projects.value.map((item) => ({ label: item.name, value: item.id })),
])

const activeFilterCount = computed(() => (projectId.value ? 1 : 0) + (health.value ? 1 : 0))

const filtered = computed(() =>
  rows.value.filter((row) => {
    if (keyword.value && !row.name.includes(keyword.value.trim())) return false
    if (projectId.value && row.projectId !== projectId.value) return false
    if (health.value && row.health !== health.value) return false
    return true
  }),
)

function projectName(id: string): string {
  return projects.value.find((item) => item.id === id)?.name ?? '—'
}

function firstBinding(appId: string): Binding | null {
  return bindingsByApp.value[appId]?.[0] ?? null
}

function envNameOf(environmentId: string): string {
  return environments.value.find((item) => item.id === environmentId)?.name ?? environmentId
}

function envText(appId: string): string {
  const bindings = bindingsByApp.value[appId] ?? []
  if (!bindings.length) return 'Not configured'
  const first = bindings[0]
  const name = envNameOf(first.environmentId)
  return bindings.length > 1 ? `${name} +${bindings.length - 1}` : name
}

function clusterText(appId: string): string {
  const binding = firstBinding(appId)
  if (!binding) return '—'
  return binding.target.clusterId
}

function namespaceText(appId: string): string {
  return firstBinding(appId)?.target.namespace ?? '—'
}

function healthLabel(value: Health): { text: string; cls: string } {
  const map: Record<Health, { text: string; cls: string }> = {
    healthy: { text: 'Healthy', cls: 'dot--ok' },
    completed: { text: 'Completed', cls: 'dot--ok' },
    degraded: { text: 'Degraded', cls: 'dot--bad' },
    progressing: { text: 'Progressing', cls: 'dot--warn' },
    stopped: { text: 'Stopped', cls: 'dot--idle' },
    unknown: { text: 'Not configured', cls: 'dot--idle' },
  }
  return map[value]
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [appPage, projectList, envList] = await Promise.all([
      listApplications({ pageSize: 100 }),
      listProjects(),
      listEnvironments(),
    ])
    rows.value = appPage.items
    projects.value = projectList
    environments.value = envList
    const pairs = await Promise.all(
      appPage.items.map(async (app) => [app.id, await listBindings(app.id)] as const),
    )
    bindingsByApp.value = Object.fromEntries(pairs)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '应用列表加载失败'
  } finally {
    loading.value = false
  }
}

function resetFilters(): void {
  projectId.value = ''
  health.value = ''
  keyword.value = ''
}

watch([projectId, health], () => {
  /* 本地筛选，无需重新请求 */
})

void load()
</script>

<template>
  <div class="applist">
    <div class="tk-toolbar">
      <t-input
        v-model="keyword"
        class="tk-toolbar__search"
        placeholder="按应用名称搜索"
        clearable
        size="small"
      >
        <template #prefix-icon><t-icon name="search" /></template>
        <template #suffix><span class="applist__kbd">/</span></template>
      </t-input>

      <t-popup v-model:visible="filterOpen" trigger="click" placement="bottom-left">
        <t-button size="small" variant="outline">
          <template #icon><t-icon name="filter" /></template>
          Filter
          <span v-if="activeFilterCount" class="applist__badge">{{ activeFilterCount }}</span>
        </t-button>
        <template #content>
          <div class="applist__filter">
            <label class="applist__filter-row">
              <span>项目</span>
              <t-select v-model="projectId" :options="projectOptions" size="small" class="applist__filter-control" />
            </label>
            <label class="applist__filter-row">
              <span>健康状态</span>
              <t-select v-model="health" :options="healthOptions" size="small" class="applist__filter-control" />
            </label>
            <div class="applist__filter-foot">
              <t-button size="small" variant="text" @click="resetFilters">清空</t-button>
            </div>
          </div>
        </template>
      </t-popup>

      <span class="u-right u-flex u-gap-8">
        <t-button size="small" variant="text" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
        <t-button size="small" variant="outline">
          <template #icon><t-icon name="download" /></template>
          导出 CSV
        </t-button>
        <t-button theme="primary" size="small" @click="$router.push('/')">
          <template #icon><t-icon name="add" /></template>
          创建
        </t-button>
      </span>
    </div>

    <section class="tk-panel">
      <div v-if="loading" class="applist__state"><t-loading size="small" /> 加载应用…</div>
      <div v-else-if="error" class="applist__state">
        <t-icon name="error-circle" />
        <span>{{ error }}</span>
        <t-button size="small" variant="outline" @click="load">重试</t-button>
      </div>
      <t-table v-else :data="filtered" row-key="id" size="small" hover :columns="[
        { colKey: 'name', title: '应用名称', width: 280 },
        { colKey: 'environment', title: '环境', width: 180 },
        { colKey: 'cluster', title: '集群', width: 170 },
        { colKey: 'namespace', title: '命名空间', width: 170 },
        { colKey: 'lastDeployedAt', title: '最近发布', width: 160 },
        { colKey: 'ops', title: '', width: 60 },
      ]">
        <template #name="{ row }">
          <div class="applist__name">
            <span class="applist__appicon"><t-icon name="app" size="13px" /></span>
            <router-link
              class="applist__link"
              :to="{ name: 'app-overview', params: { projectId: row.projectId, appId: row.id } }"
            >
              {{ row.name }}
            </router-link>
            <span class="applist__health" :class="healthLabel(row.health).cls">{{ healthLabel(row.health).text }}</span>
          </div>
          <p class="applist__meta">{{ projectName(row.projectId) }}</p>
        </template>
        <template #environment="{ row }">{{ envText(row.id) }}</template>
        <template #cluster="{ row }">{{ clusterText(row.id) }}</template>
        <template #namespace="{ row }">
          <span class="u-mono">{{ namespaceText(row.id) }}</span>
        </template>
        <template #lastDeployedAt="{ row }">
          {{ row.lastDeployedAt ? fmtRelative(row.lastDeployedAt) : '—' }}
        </template>
        <template #ops="{ row }">
          <router-link
            class="applist__gear"
            :to="{ name: 'config-git', params: { projectId: row.projectId, appId: row.id } }"
            title="应用配置"
          >
            <t-icon name="setting" size="15px" />
          </router-link>
        </template>
      </t-table>

      <div v-if="!loading && !error && !filtered.length" class="applist__state">
        <span>没有匹配的应用</span>
        <t-button size="small" variant="outline" @click="resetFilters">清空筛选</t-button>
      </div>
    </section>

    <p class="applist__count">共 {{ filtered.length }} 个应用 · 环境与集群来自已保存的环境绑定</p>
  </div>
</template>

<style scoped>
.applist__kbd {
  padding: 0 5px;
  color: var(--tk-text-3);
  font-size: 11px;
  border: 1px solid var(--tk-border);
  border-radius: 3px;
}
.applist__badge {
  margin-left: 4px;
  padding: 0 5px;
  color: #fff;
  font-size: 10px;
  background: var(--tk-primary);
  border-radius: 8px;
}
.applist__filter {
  width: 240px;
  padding: 10px 12px;
}
.applist__filter-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  color: var(--tk-text-2);
}
.applist__filter-control {
  width: 100%;
}
.applist__filter-foot {
  display: flex;
  justify-content: flex-end;
}
.applist__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 12px;
  color: var(--tk-text-2);
}
.applist__name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.applist__appicon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--tk-primary);
  background: var(--tk-primary-weak);
  border-radius: 4px;
}
.applist__link {
  font-weight: 500;
}
.applist__health {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--tk-text-3);
}
.applist__health::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.dot--ok {
  color: #2ba471;
}
.dot--bad {
  color: var(--tk-danger);
}
.dot--warn {
  color: var(--tk-warning);
}
.dot--idle {
  color: #b3bac7;
}
.applist__meta {
  margin: 2px 0 0 28px;
  color: var(--tk-text-3);
  font-size: 11px;
}
.applist__gear {
  color: var(--tk-text-3);
}
.applist__gear:hover {
  color: var(--tk-primary);
}
.applist__count {
  margin: 8px 2px 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
</style>
