<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getProject, listApplications, listBindings, listClusters, listEnvironments, listTeams } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import FilterBar from '@/components/FilterBar.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { Application, Binding, Cluster, Environment, Project } from '@/types'
import { fmtRelative } from '@/utils/format'
import CreateApplicationDrawer from '@/views/apps/components/onboarding/CreateApplicationDrawer.vue'

const route = useRoute()
const projectId = computed(() => String(route.params.projectId ?? ''))

const loading = ref(true)
const error = ref('')
const project = ref<Project | null>(null)
const teamName = ref('')
const apps = ref<Application[]>([])
const bindingsByApp = ref<Record<string, Binding[]>>({})
const environments = ref<Environment[]>([])
const clusters = ref<Cluster[]>([])

const keyword = ref('')
const health = ref('')
const source = ref('')

const createOpen = ref(false)

const healthOptions = [
  { label: '全部健康状态', value: '' },
  { label: '健康', value: 'healthy' },
  { label: '进行中', value: 'progressing' },
  { label: '异常', value: 'degraded' },
  { label: '已完成', value: 'completed' },
  { label: '已停止', value: 'stopped' },
  { label: '未知', value: 'unknown' },
]

const sourceOptions = [
  { label: '全部来源', value: '' },
  { label: 'Git 源码', value: 'git' },
  { label: '已有镜像', value: 'image' },
]

const columns = [
  { colKey: 'name', title: '应用名称', width: 300 },
  { colKey: 'environment', title: '环境', width: 180 },
  { colKey: 'cluster', title: '集群', width: 170 },
  { colKey: 'namespace', title: '命名空间', width: 170 },
  { colKey: 'lastDeployedAt', title: '最近发布', width: 160 },
  { colKey: 'actions', title: '', width: 56 },
]

const filtered = computed<Application[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return apps.value.filter((app) => {
    if (kw && !app.name.toLowerCase().includes(kw) && !app.description.toLowerCase().includes(kw)) return false
    if (health.value && app.health !== health.value) return false
    if (source.value && app.sourceMode !== source.value) return false
    return true
  })
})

const headerDescription = computed(() => {
  if (!project.value) return '加载中…'
  return `${teamName.value} · ${apps.value.length} 个应用`
})

async function load(): Promise<void> {
  if (!projectId.value) return
  loading.value = true
  error.value = ''
  try {
    const [projectItem, appPage, teamItems] = await Promise.all([
      getProject(projectId.value),
      listApplications({ projectId: projectId.value, page: 1, pageSize: 500 }),
      listTeams(),
    ])
    project.value = projectItem
    apps.value = appPage.items
    teamName.value = teamItems.find((team) => team.id === projectItem.teamId)?.name ?? projectItem.teamId
    const [bindingPairs, envList, clusterList] = await Promise.all([
      Promise.all(appPage.items.map(async (app) => [app.id, await listBindings(app.id)] as const)),
      listEnvironments(),
      listClusters(),
    ])
    bindingsByApp.value = Object.fromEntries(bindingPairs)
    environments.value = envList
    clusters.value = clusterList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载项目失败'
  } finally {
    loading.value = false
  }
}

watch(projectId, load, { immediate: true })

function envNameOf(environmentId: string): string {
  return environments.value.find((env) => env.id === environmentId)?.name ?? environmentId
}

function bindingOf(appId: string): Binding | null {
  return bindingsByApp.value[appId]?.[0] ?? null
}

function envText(appId: string): string {
  const list = bindingsByApp.value[appId] ?? []
  if (!list.length) return '未配置'
  const first = envNameOf(list[0].environmentId)
  return list.length > 1 ? `${first} +${list.length - 1}` : first
}

function clusterText(appId: string): string {
  const binding = bindingOf(appId)
  if (!binding) return '—'
  return clusters.value.find((cluster) => cluster.id === binding.target.clusterId)?.name ?? binding.target.clusterId
}

function namespaceText(appId: string): string {
  return bindingOf(appId)?.target.namespace ?? '—'
}

function onKeywordChange(value: string): void {
  keyword.value = value
}

function onHealthChange(value: unknown): void {
  health.value = typeof value === 'string' ? value : ''
}

function onSourceChange(value: unknown): void {
  source.value = typeof value === 'string' ? value : ''
}

function clearFilters(): void {
  keyword.value = ''
  health.value = ''
  source.value = ''
}

function openCreate(): void {
  createOpen.value = true
}
</script>

<template>
  <div class="project-detail">
    <PageHeader back="/" :title="project?.name ?? '项目详情'" :description="headerDescription">
      <template #actions>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建应用
        </t-button>
      </template>
    </PageHeader>

    <FilterBar :keyword="keyword" placeholder="按应用名称或描述搜索" @update:keyword="onKeywordChange">
      <template #extra>
        <t-select
          class="project-detail__select"
          :value="health"
          :options="healthOptions"
          placeholder="健康状态"
          clearable
          @change="onHealthChange"
        />
        <t-select
          class="project-detail__select"
          :value="source"
          :options="sourceOptions"
          placeholder="来源"
          clearable
          @change="onSourceChange"
        />
      </template>
      <template #actions>
        <span class="u-dim">共 {{ filtered.length }} 个应用</span>
      </template>
    </FilterBar>

    <section class="tk-panel project-detail__table">
      <ErrorState v-if="error" :message="error" @retry="load" />

      <EmptyState
        v-else-if="!loading && apps.length === 0"
        title="还没有应用"
        description="应用是构建与发布的最小单位，先创建一个应用，再按步骤完成配置。"
        icon="app"
      >
        <template #action>
          <t-button theme="primary" size="small" @click="openCreate">新建应用</t-button>
        </template>
      </EmptyState>

      <EmptyState
        v-else-if="!loading && filtered.length === 0"
        compact
        title="没有匹配的应用"
        description="调整关键字或清空筛选条件后再试。"
        icon="search"
      >
        <template #action>
          <t-button size="small" variant="outline" @click="clearFilters">清空筛选</t-button>
        </template>
      </EmptyState>

      <t-table v-else row-key="id" :data="filtered" :columns="columns" :loading="loading" size="small" hover>
        <template #name="{ row }">
          <router-link class="project-detail__name" :to="{ name: 'app-overview', params: { projectId, appId: row.id } }">
            {{ row.name }}
          </router-link>
        </template>
        <template #environment="{ row }">{{ envText(row.id) }}</template>
        <template #cluster="{ row }">{{ clusterText(row.id) }}</template>
        <template #namespace="{ row }">
          <span class="u-mono">{{ namespaceText(row.id) }}</span>
        </template>
        <template #lastDeployedAt="{ row }">
          <span v-if="row.lastDeployedAt">{{ fmtRelative(row.lastDeployedAt) }}</span>
          <span v-else class="u-dim">—</span>
        </template>
        <template #actions="{ row }">
          <router-link
            class="project-detail__gear"
            :to="{ name: 'config-git', params: { projectId, appId: row.id } }"
            title="应用配置"
          >
            <t-icon name="setting" size="15px" />
          </router-link>
        </template>
      </t-table>
    </section>

    <CreateApplicationDrawer v-model:visible="createOpen" :project-id="projectId" />
  </div>
</template>

<style scoped>
.project-detail__select {
  width: 150px;
}
.project-detail__table {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.project-detail__name {
  color: #0066cc;
  font-weight: 500;
}
.project-detail__gear {
  display: inline-flex;
  align-items: center;
  color: #767d84;
}
.project-detail__gear:hover {
  color: #0066cc;
}
</style>
