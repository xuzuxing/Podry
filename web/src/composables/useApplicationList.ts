import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listApplications, listBindings, listClusters, listEnvironments, listProjects } from '@/api'
import type { Application, Binding, Cluster, Environment, Project } from '@/types'
import type { FilterGroup } from '@/components/application/ApplicationFilters.vue'

const FILTER_KEYS = ['project', 'appStatus', 'environment', 'cluster', 'namespace'] as const

export function useApplicationList() {
  const route = useRoute()
  const router = useRouter()
  const rows = ref<Application[]>([])
  const projects = ref<Project[]>([])
  const clusters = ref<Cluster[]>([])
  const environments = ref<Environment[]>([])
  const bindings = ref<Record<string, Binding[]>>({})
  const loading = ref(false)
  const error = ref('')
  const refreshedAt = ref(Date.now())
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  let request = 0
  const keyword = computed({ get: () => String(route.query.searchKey ?? ''), set: (value: string) => { void router.replace({ query: { ...route.query, searchKey: value || undefined } }) } })
  const filters = computed<Record<string, string[]>>({
    get: () => Object.fromEntries(FILTER_KEYS.map((key) => [key, String(route.query[key] ?? '').split(',').filter(Boolean)])),
    set: (value) => { const query = { ...route.query }; for (const key of FILTER_KEYS) { const selected = value[key]?.join(','); if (selected) query[key] = selected; else delete query[key] } void router.replace({ query }) },
  })
  const filterGroups = computed<FilterGroup[]>(() => [
    { key: 'project', label: '项目', options: projects.value.map((item) => ({ label: item.name, value: item.id })) },
    { key: 'appStatus', label: '应用状态', options: [{label:'健康',value:'healthy'},{label:'异常',value:'degraded'},{label:'进行中',value:'progressing'},{label:'未配置',value:'unknown'},{label:'已停止',value:'stopped'},{label:'已完成',value:'completed'}] },
    { key: 'environment', label: '环境', options: environments.value.map((item) => ({ label: item.name, value: item.id })) },
    { key: 'cluster', label: '集群', options: clusters.value.map((item) => ({ label: item.name, value: item.id })) },
    { key: 'namespace', label: '命名空间', options: [...new Set(Object.values(bindings.value).flat().map((item) => item.target.namespace))].map((value) => ({ label: value, value })) },
  ])
  const filtered = computed(() => {
    const value = filters.value
    const match = (key: string, input: string) => !value[key]?.length || value[key].includes(input)
    // 本地筛选，无需重新请求；环境/集群/命名空间必须命中同一个环境绑定。
    return rows.value.filter((app) => app.name.toLowerCase().includes(keyword.value.trim().toLowerCase()) && match('project', app.projectId) && match('appStatus', app.health) &&
      (!value.environment?.length && !value.cluster?.length && !value.namespace?.length || (bindings.value[app.id] ?? []).some((binding) => match('environment', binding.environmentId) && match('cluster', binding.target.clusterId) && match('namespace', binding.target.namespace))))
  })
  const refreshedLabel = computed(() => { const seconds = Math.max(0, Math.floor((now.value - refreshedAt.value) / 1000)); return seconds < 10 ? '刚刚' : seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分钟前` })
  async function load(): Promise<void> {
    const current = ++request
    loading.value = true; error.value = ''
    try {
      const [apps, projectList, clusterList, envList] = await Promise.all([listApplications({ pageSize: 500 }), listProjects(), listClusters(), listEnvironments()])
      const pairs = await Promise.all(apps.items.map(async (app) => [app.id, await listBindings(app.id)] as const))
      if (current !== request) return
      rows.value = apps.items; projects.value = projectList; clusters.value = clusterList; environments.value = envList; bindings.value = Object.fromEntries(pairs)
      refreshedAt.value = Date.now(); now.value = Date.now()
    } catch (err) { if (current === request) error.value = err instanceof Error ? err.message : '应用列表加载失败' }
    finally { if (current === request) loading.value = false }
  }
  function resetFilters(): void { const query = { ...route.query }; for (const key of FILTER_KEYS) delete query[key]; delete query.searchKey; void router.replace({ query }) }
  function exportCsv(): void {
    const lines = [['APP NAME', 'PROJECT', 'ENVIRONMENT', 'CLUSTER', 'NAMESPACE', 'LAST DEPLOYED AT']]
    for (const app of filtered.value) {
      const appBindings = bindings.value[app.id] ?? []
      for (const binding of appBindings.length ? appBindings : [null]) lines.push([app.name, projects.value.find((item) => item.id === app.projectId)?.name ?? '', binding ? environments.value.find((item) => item.id === binding.environmentId)?.name ?? '' : '', binding ? clusters.value.find((item) => item.id === binding.target.clusterId)?.name ?? '' : '', binding?.target.namespace ?? '', app.lastDeployedAt ?? ''])
    }
    const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`
    const url = URL.createObjectURL(new Blob(['\ufeff' + lines.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'applications.csv'; link.click(); URL.revokeObjectURL(url)
  }
  onMounted(() => { void load(); timer = setInterval(() => { now.value = Date.now() }, 10000) })
  onUnmounted(() => { request++; if (timer) clearInterval(timer) })
  return { rows, projects, clusters, environments, bindings, loading, error, keyword, filters, filterGroups, filtered, refreshedLabel, load, resetFilters, exportCsv }
}
