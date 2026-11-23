import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApplication, getBuild, getConfig, getDeployment, listArtifacts, listBindings, listBuilds, listDeployments, listEnvironments, listProjects } from '@/api'
import type { AppConfig, Application, Artifact, Binding, Build, Deployment, Environment, Project } from '@/types'
import { overviewEnvironments } from '@/utils/applicationOverview'

export function useApplicationOverview() {
  const route = useRoute(), router = useRouter()
  const appId = computed(() => String(route.params.appId ?? ''))
  const app = ref<Application|null>(null)
  const config = ref<AppConfig|null>(null)
  const bindings = ref<Binding[]>([]), environments = ref<Environment[]>([]), projects = ref<Project[]>([])
  const deployments = ref<Deployment[]>([]), artifacts = ref<Artifact[]>([]), builds = ref<Build[]>([])
  const loading = shallowRef(true), error = shallowRef('')
  let request = 0
  const tab = computed(() => route.query.tab === 'environments' ? 'environments' : 'about')
  const project = computed(() => projects.value.find(item => item.id === app.value?.projectId) ?? null)
  const rows = computed(() => overviewEnvironments(bindings.value,environments.value,deployments.value,artifacts.value,builds.value))
  async function load(): Promise<void> {
    const token = ++request, id = appId.value
    loading.value = true; error.value = ''
    try {
      // 尚未生成配置的应用不阻塞概览
      const result = await Promise.all([getApplication(id),getConfig(id).catch(() => null),listBindings(id),listEnvironments(),listProjects(),listDeployments(id),listArtifacts(id),listBuilds(id)])
      if (token !== request) return
      const [application,configuration,bindingItems,environmentItems,projectItems,deployPage,artifactItems,buildPage] = result
      // A bound deployment/source can be older than the history list's 50 rows.
      const missingDeployments = await Promise.all(bindingItems.filter(binding => binding.currentDeploymentId && !deployPage.items.some(item=>item.id===binding.currentDeploymentId)).map(binding=>getDeployment(binding.currentDeploymentId!).catch(()=>null)))
      if (token !== request) return
      const deploymentItems = [...deployPage.items,...missingDeployments.filter((item):item is Deployment=>!!item && item.appId===id)]
      const referencedBuilds = new Set(artifactItems.filter(artifact=>deploymentItems.some(item=>item.artifactId===artifact.id)).map(artifact=>artifact.buildId).filter((item):item is string=>!!item))
      const missingBuilds = await Promise.all([...referencedBuilds].filter(buildId=>!buildPage.items.some(item=>item.id===buildId)).map(buildId=>getBuild(buildId).catch(()=>null)))
      if (token !== request) return
      app.value=application;config.value=configuration;bindings.value=bindingItems;environments.value=environmentItems;projects.value=projectItems
      deployments.value=deploymentItems;artifacts.value=artifactItems;builds.value=[...buildPage.items,...missingBuilds.filter((item):item is Build=>!!item && item.appId===id)]
    } catch (err) { if (token === request) error.value = err instanceof Error ? err.message : '加载应用概览失败' }
    finally { if (token === request) loading.value = false }
  }
  function setTab(value: 'about'|'environments'): void { void router.replace({query:{...route.query,tab:value}}) }
  watch(appId,load,{immediate:true})
  watch(() => route.query.tab,value => {
    if (value !== 'about' && value !== 'environments') void router.replace({query:{...route.query,tab:'about'}})
  },{immediate:true})
  onBeforeUnmount(() => { ++request })
  function artifactSaved(saved:Artifact):void { artifacts.value=artifacts.value.map(item=>item.id===saved.id&&saved.appId===appId.value?saved:item) }
  return {appId,app,config,project,projects,loading,error,tab,rows,load,setTab,artifactSaved}
}
