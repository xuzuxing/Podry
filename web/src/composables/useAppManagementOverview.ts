import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { getWorkflow, listApplications, listBindings, listBuilds, listDeployments, listEnvironments, listProjects } from '@/api'
import type { Application, Binding, Build, Deployment, Environment, Workflow } from '@/types'

export interface OverviewApplication {
  app: Application
  workflow: Workflow | null
  bindings: Binding[]
  builds: Build[]
  deployments: Deployment[]
}

export function useAppManagementOverview() {
  const loading = shallowRef(true)
  const error = shallowRef('')
  const warnings = shallowRef<string[]>([])
  const projectCount = shallowRef(0)
  const environments = shallowRef<Environment[]>([])
  const entries = shallowRef<OverviewApplication[]>([])
  const now = shallowRef(new Date())
  let generation = 0

  const pipelines = computed(() => entries.value.flatMap(entry => (entry.workflow?.items ?? []).map(pipeline => ({ entry, pipeline }))))
  const productionEnvironments = computed(() => new Set(environments.value.filter(env => env.production).map(env => env.id)))
  // 生产流水线：CD 绑定的 binding 指向生产环境；按流水线统计，避免把所有绑定都算成流水线。
  const productionPipelines = computed(() => pipelines.value.filter(({ entry, pipeline }) => pipeline.kind === 'cd' && entry.bindings.some(binding => binding.id === pipeline.bindingId && productionEnvironments.value.has(binding.environmentId))))
  const productionDeployments = computed(() => entries.value.flatMap(entry => entry.deployments.filter(deployment => entry.bindings.some(binding => binding.id === deployment.bindingId && productionEnvironments.value.has(binding.environmentId)))))
  const builds = computed(() => entries.value.flatMap(entry => entry.builds))
  const deployments = computed(() => entries.value.flatMap(entry => entry.deployments))

  async function load(): Promise<void> {
    const current = ++generation
    loading.value = true
    error.value = ''
    try {
      const [projects, firstPage, envs] = await Promise.all([listProjects(), listApplications({ page: 1, pageSize: 100 }), listEnvironments()])
      const applications = [...firstPage.items]
      for (let page = 2; applications.length < firstPage.total; page++) {
        const next = await listApplications({ page, pageSize: 100 })
        if (!next.items.length) break
        applications.push(...next.items)
      }
      const notices = new Set<string>()
      const details: OverviewApplication[] = []
      // 有界并发，避免应用较多时同时扇出数百个历史请求。
      for (let offset = 0; offset < applications.length; offset += 8) {
        if (current !== generation) return
        const batch = await Promise.all(applications.slice(offset, offset + 8).map(async app => {
          const [workflow, bindings, buildPage, deployPage] = await Promise.allSettled([getWorkflow(app.id), listBindings(app.id), listBuilds(app.id), listDeployments(app.id)])
          if ([workflow, bindings, buildPage, deployPage].some(result => result.status === 'rejected')) notices.add('部分应用数据读取失败，当前统计仅包含已读取的数据。请刷新重试。')
          for (const result of [buildPage, deployPage]) {
            if (result.status === 'fulfilled' && result.value.total > result.value.items.length) notices.add('历史接口仅返回每个应用最近 50 条记录，趋势和排行基于已返回记录，不能代表完整历史。')
          }
          return { app, workflow: workflow.status === 'fulfilled' ? workflow.value : null, bindings: bindings.status === 'fulfilled' ? bindings.value : [], builds: buildPage.status === 'fulfilled' ? buildPage.value.items : [], deployments: deployPage.status === 'fulfilled' ? deployPage.value.items : [] }
        }))
        details.push(...batch)
      }
      if (current !== generation) return
      projectCount.value = projects.length
      environments.value = envs
      entries.value = details
      warnings.value = [...notices]
      now.value = new Date()
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : '加载应用概览失败'
    } finally { if (current === generation) loading.value = false }
  }

  onMounted(load)
  onBeforeUnmount(() => { generation++ })
  return { loading, error, warnings, projectCount, environments, entries, pipelines, productionPipelines, productionDeployments, builds, deployments, now, load }
}
