import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { getConfig, getWorkflow, listBranches, listCommits, listWebhookEvents, setPipelineBranches, MockError } from '@/api'
import type { AppConfig, CIDefinition, CISource, GitBranch, GitCommit, GitMaterial, GitWebhookEvent, Workflow } from '@/types'
import { ciSourcesOf, effectiveBuildConfig, sourceMatches } from '@/utils/pipelineBuild'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import { isWebhookSource, webhookMatches } from '@/utils/gitSources'

export interface MaterialSelectionState {
  material: GitMaterial
  source: CISource
  branches: GitBranch[]
  branch: string
  commits: GitCommit[]
  selectedSha: string
  events: GitWebhookEvent[]
  selectedEventId: string
  search: string
  showExcluded: boolean
  loading: boolean
  error: string
  errorCode: string
  request: number
}

export function useBuildMaterials(visible: Readonly<Ref<boolean>>, appId: Readonly<Ref<string>>, pipelineId: Readonly<Ref<string>>) {
  const states = ref<MaterialSelectionState[]>([])
  const activeId = shallowRef('')
  const config = ref<AppConfig | null>(null)
  const workflow = ref<Workflow | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  const errorCode = shallowRef('')
  const branchSaving = shallowRef(false)
  const branchError = shallowRef('')
  const active = computed(() => states.value.find(item => item.material.id === activeId.value))
  const definition = computed(() => workflow.value?.items.find(item => item.id === pipelineId.value)?.definition as CIDefinition | undefined)
  const effectiveConfig = computed(() => config.value && definition.value ? effectiveBuildConfig(config.value, definition.value) : null)
  const selectedCount = computed(() => states.value.filter(item => item.selectedSha).length)
  let generation = 0
  onScopeDispose(() => { generation++ })

  function setError(target: { error: string; errorCode: string }, err: unknown) {
    target.error = err instanceof Error ? err.message : 'Git 提交读取失败'
    target.errorCode = err instanceof MockError ? err.code : ''
  }

  async function refresh(state: MaterialSelectionState, includeBranches = true) {
    const current = generation
    const request = ++state.request
    state.loading = true
    state.error = ''
    state.errorCode = ''
    const valid = () => current === generation && request === state.request && visible.value
    try {
      if (isWebhookSource(state.source)) {
        const events = await listWebhookEvents(appId.value, pipelineId.value, state.material.id)
        if (!valid()) return
        state.events = events
        const selected = events.find(event => event.id === state.selectedEventId && !event.commit.excluded && webhookMatches(state.source, event))
        if (!selected) { state.selectedEventId = ''; state.selectedSha = ''; state.branch = '' }
        else { state.selectedSha = selected.commit.sha; state.branch = selected.ref }
        return
      }
      if (includeBranches) {
        const branches = await listBranches(appId.value, state.material.id)
        if (!valid()) return
        state.branches = branches.filter(item => sourceMatches(state.source, item.name))
        if (state.source.type === 'branch') state.branch = state.source.value
        if (state.branch && !sourceMatches(state.source, state.branch)) {
          state.branch = ''
          state.selectedSha = ''
        }
      }
      if (!state.branch) { state.commits = []; state.selectedSha = ''; return }
      const commits = await listCommits(state.branch, appId.value, state.material.id)
      if (!valid()) return
      state.commits = commits
      if (!commits.some(item => item.sha === state.selectedSha && !item.excluded)) state.selectedSha = ''
    } catch (err) { if (valid()) setError(state, err) }
    finally { if (valid()) state.loading = false }
  }

  async function load() {
    const current = ++generation
    states.value = []
    activeId.value = ''
    config.value = null
    workflow.value = null
    loading.value = true
    error.value = ''
    errorCode.value = ''
    branchError.value = ''
    try {
      const [cfg, wf] = await Promise.all([getConfig(appId.value), getWorkflow(appId.value)])
      if (current !== generation) return
      const pipeline = wf.items.find(item => item.id === pipelineId.value && item.kind === 'ci')
      if (!pipeline) throw new MockError('pipeline_required', '构建流水线已不存在，请刷新页面', 422)
      const sources = ciSourcesOf(cfg, pipeline.definition as CIDefinition)
      const materials = gitMaterialsOf(cfg)
      if (!materials.length) throw new MockError('git_not_configured', '尚未配置 Git 源', 422)
      config.value = cfg
      workflow.value = wf
      states.value = materials.map((material, index) => ({ material, source: sources[index]!, branches: [], branch: sources[index]!.type === 'regex' ? sources[index]!.selectedBranch ?? '' : '', commits: [], selectedSha: '', events: [], selectedEventId: '', search: '', showExcluded: false, loading: true, error: '', errorCode: '', request: 0 }))
      activeId.value = materials[0]!.id
      await Promise.all(states.value.map(state => refresh(state)))
    } catch (err) {
      if (current === generation) {
        const target = { error: '', errorCode: '' }; setError(target, err)
        error.value = target.error; errorCode.value = target.errorCode
      }
    } finally { if (current === generation) loading.value = false }
  }

  function selectEvent(id: string) {
    const state = active.value
    const event = state?.events.find(item => item.id === id && !item.commit.excluded && webhookMatches(state.source, item))
    if (!state || !event || state.loading) return
    state.selectedEventId = id
    state.selectedSha = event.commit.sha
    state.branch = event.ref
  }

  async function saveBranches(branches: Array<{ gitMaterialId: string; branch: string }>): Promise<boolean> {
    if (!workflow.value || !config.value || branchSaving.value) return false
    const current = generation
    branchSaving.value = true
    branchError.value = ''
    try {
      const saved = await setPipelineBranches(appId.value, pipelineId.value, branches, workflow.value.version, config.value.version)
      if (current !== generation || !visible.value) return false
      workflow.value = saved
      const changed = states.value.filter(state => state.source.type === 'regex' && state.branch !== branches.find(item => item.gitMaterialId === state.material.id)?.branch.trim())
      for (const state of changed) {
        state.branch = branches.find(item => item.gitMaterialId === state.material.id)!.branch.trim()
        state.source = { ...state.source, selectedBranch: state.branch }
        state.selectedSha = ''; state.search = ''
      }
      await Promise.all(changed.map(state => refresh(state, false)))
      return current === generation
    } catch (err) {
      if (current === generation) branchError.value = err instanceof Error ? err.message : '设置分支失败'
      return false
    } finally { branchSaving.value = false }
  }

  watch([visible, appId, pipelineId], ([isVisible]) => { if (isVisible) void load(); else generation++ }, { immediate: true })
  return { states, activeId, active, config, workflow, definition, effectiveConfig, selectedCount, loading, error, errorCode, load, refresh, selectEvent, saveBranches, branchSaving, branchError }
}
