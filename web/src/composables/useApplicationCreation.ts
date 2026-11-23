import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { createApplication, listApplications, listProjects } from '@/api'
import type { Application, Project } from '@/types'
import { applicationCreationErrors, applicationLabels } from '@/utils/applicationCreation'
import type { ApplicationIdentityDraft } from '@/utils/applicationCreation'
import { readApplicationCloneSources } from '@/utils/applicationCloneSources'
import { usePipelineDraft } from './usePipelineDraft'

interface CreationOptions {
  visible: () => boolean; projectId: () => string | undefined
  initialMode: () => 'scratch' | 'clone' | undefined; sourceId: () => string | undefined
  close: () => void; created: (application: Application) => void
}
const emptyDraft = (projectId = ''): ApplicationIdentityDraft => ({projectId, name:'', description:'', sourceMode:'git', tags:[{id:1,key:'',value:'',propagate:false}]})

export function useApplicationCreation(options: CreationOptions) {
  const router = useRouter()
  const draft = ref(emptyDraft())
  const mode = shallowRef<'scratch' | 'clone'>('scratch')
  const sourceId = shallowRef('')
  const projects = ref<Project[]>([])
  const apps = ref<Application[]>([])
  const projectLoading = shallowRef(false)
  const appsLoading = shallowRef(false)
  const projectError = shallowRef('')
  const appsError = shallowRef('')
  const submitting = shallowRef(false)
  const submitted = shallowRef(false)
  const formError = shallowRef('')
  const tagsExpanded = shallowRef(false)
  let generation = 0
  let projectRequest = 0
  let appsRequest = 0
  let mounted = true
  const source = computed(() => apps.value.find(item => item.id === sourceId.value))
  const showingForm = computed(() => mode.value === 'scratch' || !!source.value)
  const errors = computed(() => applicationCreationErrors(draft.value, projects.value.map(item => item.id)))
  const effectiveSourceMode = computed(() => mode.value === 'clone' ? source.value?.sourceMode ?? 'git' : draft.value.sourceMode)
  // The existing drawer draft guard is independent of pipeline data; reuse its
  // close/route/beforeunload handling with this form's own snapshot.
  const {dirty, discardVisible, markClean, resolveDiscard, requestClose} = usePipelineDraft({
    visible: options.visible, saving: submitting, snapshot: () => JSON.stringify(draft.value), close: options.close,
  })
  async function loadProjects(): Promise<void> {
    const token = generation, request = ++projectRequest
    projectLoading.value = true; projectError.value = ''
    try {
      const result = await listProjects()
      if (token !== generation || request !== projectRequest) return
      projects.value = result
    } catch (err) { if (token === generation && request === projectRequest) projectError.value = err instanceof Error ? err.message : '项目加载失败' }
    finally { if (token === generation && request === projectRequest) projectLoading.value = false }
  }
  async function loadApps(): Promise<void> {
    const token = generation, request = ++appsRequest
    appsLoading.value = true; appsError.value = ''
    try {
      const result = await readApplicationCloneSources(listApplications, () => token === generation && request === appsRequest)
      if (token !== generation || request !== appsRequest) return
      apps.value = result
      if (sourceId.value && !source.value) { sourceId.value = ''; formError.value = '源应用不存在或已归档，请重新选择。' }
    } catch (err) { if (token === generation && request === appsRequest) appsError.value = err instanceof Error ? err.message : '源应用加载失败' }
    finally { if (token === generation && request === appsRequest) appsLoading.value = false }
  }
  function changeMode(value: 'scratch' | 'clone'): void {
    if (submitting.value || mode.value === value) return
    mode.value = value; sourceId.value = ''; formError.value = ''
  }
  function selectSource(id: string): void {
    if (submitting.value) return
    sourceId.value = id; formError.value = ''
  }
  function backToSources(): void { if (!submitting.value) { sourceId.value = ''; formError.value = '' } }
  async function submit(): Promise<void> {
    if (submitting.value || projectLoading.value || (mode.value === 'clone' && appsLoading.value)) return
    submitted.value = true; formError.value = ''
    if (mode.value === 'clone' && !source.value) { formError.value = '请选择要克隆的源应用'; return }
    if (projectError.value) { formError.value = '请先重新加载项目'; return }
    const invalidTags = errors.value.tags.some(row => row.key || row.value)
    if (invalidTags) tagsExpanded.value = true
    if (errors.value.projectId || errors.value.name || errors.value.description || invalidTags) {
      formError.value = '请修正表单中的必填项和格式错误'; return
    }
    const identity = {...draft.value}
    const sourceMode = effectiveSourceMode.value
    const cloneFromAppId = mode.value === 'clone' ? sourceId.value : undefined
    submitting.value = true
    try {
      const application = await createApplication({projectId:identity.projectId, name:identity.name, description:identity.description.trim(), sourceMode, cloneFromAppId, labels:applicationLabels(identity.tags)})
      if (!mounted) return
      markClean(); options.created(application); options.close()
      void MessagePlugin.success(`应用 ${application.name} 已${cloneFromAppId ? '克隆' : '创建'}`)
      await nextTick()
      submitting.value = false
      await router.push({name:sourceMode === 'image' ? 'config-base-deployment' : 'config-git',params:{projectId:application.projectId,appId:application.id}})
    } catch (err) { if (mounted) formError.value = err instanceof Error ? err.message : '创建应用失败' }
    finally { if (mounted) submitting.value = false }
  }
  watch(options.visible, open => {
    ++generation
    if (!open) return
    draft.value = emptyDraft(options.projectId())
    mode.value = options.initialMode() ?? 'scratch'
    sourceId.value = options.sourceId() ?? ''
    projects.value = []; apps.value = []; submitted.value = false; tagsExpanded.value = false
    formError.value = ''; projectError.value = ''; appsError.value = ''
    markClean()
    void loadProjects(); void loadApps()
  }, {immediate:true})
  onBeforeUnmount(() => { mounted = false; ++generation })
  return {draft,mode,source,projects,apps,projectLoading,appsLoading,projectError,appsError,submitting,submitted,formError,tagsExpanded,showingForm,errors,effectiveSourceMode,dirty,discardVisible,resolveDiscard,requestClose,loadProjects,loadApps,changeMode,selectSource,backToSources,submit}
}
