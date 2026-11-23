import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { getApplication, getConfig, listBindings, listEnvironments, MockError, saveConfig, updateAppBinding } from '@/api'
import type { AppConfig, Binding, WorkloadKind } from '@/types'
import { hasOverride, mergeValues, parseValues, valuesYaml, type MergeStrategy } from '@/utils/deploymentValues'
import { notifySetupChanged } from '@/utils/appEvents'

export type DeploymentTab = 'values' | 'inherited' | 'dry-run'

export function useDeploymentTemplate() {
  const route = useRoute()
  const router = useRouter()
  const appId = computed(() => String(route.params.appId ?? ''))
  const envId = computed(() => String(route.params.envId ?? ''))
  const isOverride = computed(() => Boolean(envId.value))
  const config = ref<AppConfig | null>(null)
  const binding = ref<Binding | null>(null)
  const envName = shallowRef('')
  const appName = shallowRef('')
  const loading = shallowRef(true)
  const error = shallowRef('')
  const conflict = shallowRef(false)
  const saving = shallowRef(false)
  const mode = shallowRef<'yaml' | 'gui'>('yaml')
  const tab = shallowRef<DeploymentTab>('values')
  const draft = shallowRef('')
  const saved = shallowRef('')
  const strategy = shallowRef<MergeStrategy>('patch')
  const savedStrategy = shallowRef<MergeStrategy>('patch')
  const creating = shallowRef(false)
  const showMerged = shallowRef(false)
  const workloadKind = shallowRef<WorkloadKind>('Deployment')
  const chartVersion = shallowRef('1.4.0')
  const deleteVisible = shallowRef(false)
  const discardVisible = shallowRef(false)
  const leaveVisible = shallowRef(false)
  let loadToken = 0
  let resolveLeave: ((leave: boolean) => void) | undefined

  const enabled = computed(() => hasOverride(binding.value) || creating.value)
  const base = computed(() => config.value?.deployValues ?? {})
  const inheritedYaml = computed(() => config.value?.deployValuesYaml ?? valuesYaml(base.value))
  const parsed = computed(() => parseValues(draft.value))
  const effective = computed(() => isOverride.value && enabled.value
    ? mergeValues(base.value, parsed.value.values ?? {}, strategy.value)
    : isOverride.value ? base.value : parsed.value.values ?? {})
  const mergedYaml = computed(() => valuesYaml(effective.value))
  const yamlError = computed(() => parsed.value.error ?? '')
  const editable = computed(() => tab.value === 'values' && (!isOverride.value || enabled.value) && !showMerged.value)
  const dirty = computed(() => !loading.value && !error.value && (
    draft.value !== saved.value || strategy.value !== savedStrategy.value || creating.value ||
    (!isOverride.value && (workloadKind.value !== config.value?.chartConfig?.workloadKind || chartVersion.value !== config.value?.chartConfig?.chartVersion))
  ))
  const editorValue = computed({
    get: () => tab.value === 'inherited' ? inheritedYaml.value : showMerged.value ? mergedYaml.value : draft.value,
    set: (value: string) => { if (editable.value) draft.value = value },
  })
  const chartText = computed(() => `${workloadKind.value} · 版本 ${chartVersion.value}`)
  const versionText = computed(() => isOverride.value ? `v${binding.value?.version ?? '—'}` : `v${config.value?.version ?? '—'}`)

  function selectTab(next: DeploymentTab): void {
    tab.value = next
    void router.replace({ query: { ...route.query, headerTab: next } })
  }
  function applyTab(): void {
    const value = String(route.query.headerTab ?? '')
    tab.value = value === 'dry-run' ? value : value === 'inherited' && isOverride.value ? value
      : value === 'values' ? value : isOverride.value && !hasOverride(binding.value) ? 'inherited' : 'values'
  }
  function resetDraft(): void {
    draft.value = saved.value
    strategy.value = savedStrategy.value
    creating.value = false
    showMerged.value = false
    workloadKind.value = config.value?.chartConfig?.workloadKind ?? 'Deployment'
    chartVersion.value = config.value?.chartConfig?.chartVersion ?? '1.4.0'
    mode.value = 'yaml'
    discardVisible.value = false
  }
  function createOverride(): void {
    if (!binding.value || saving.value) return
    creating.value = true
    draft.value = strategy.value === 'replace' ? inheritedYaml.value : '{}\n'
    mode.value = 'yaml'
    showMerged.value = false
    selectTab('values')
  }
  function changeStrategy(next: MergeStrategy): void {
    // 切换策略不改写草稿；用户可直接比较两种策略下的生效值。
    strategy.value = next
  }
  function switchMode(next: 'yaml' | 'gui'): void {
    if (next === 'gui' && yamlError.value) return
    mode.value = next
  }

  async function load(): Promise<void> {
    const token = ++loadToken
    const id = appId.value
    const environmentId = envId.value
    loading.value = true
    error.value = ''
    conflict.value = false
    try {
      const [cfg, bindings, environments, app] = await Promise.all([getConfig(id), listBindings(id), listEnvironments(), getApplication(id)])
      if (token !== loadToken) return
      const current = bindings.find((item) => item.environmentId === environmentId) ?? null
      if (environmentId && !current) throw new Error('该环境尚未绑定到此应用，请先在工作流中配置部署环境')
      config.value = cfg
      binding.value = current
      appName.value = app.name
      envName.value = environments.find((item) => item.id === environmentId)?.name ?? environmentId
      workloadKind.value = cfg.chartConfig?.workloadKind ?? 'Deployment'
      chartVersion.value = cfg.chartConfig?.chartVersion ?? '1.4.0'
      saved.value = environmentId
        ? current?.overrideValuesYaml ?? valuesYaml(current?.overrideValues ?? {})
        : cfg.deployValuesYaml ?? valuesYaml(cfg.chartConfig ? cfg.deployValues : { replicaCount: 1, containerPort: 8080, ...cfg.deployValues })
      savedStrategy.value = current?.overrideMergeStrategy ?? 'patch'
      resetDraft()
      applyTab()
    } catch (err) {
      if (token === loadToken) error.value = err instanceof Error ? err.message : '部署模板加载失败'
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  function handleError(err: unknown): void {
    if (err instanceof MockError && err.code === 'revision_conflict') {
      conflict.value = true
      MessagePlugin.warning('配置已被更新，请重新加载后再保存')
    } else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
  }

  async function save(): Promise<void> {
    if (saving.value || !dirty.value || !parsed.value.values || !config.value) return
    const inputYaml = draft.value
    const inputValues = parsed.value.values
    const mergeStrategy = strategy.value
    saving.value = true
    conflict.value = false
    try {
      if (isOverride.value) {
        if (!binding.value || !enabled.value) return
        binding.value = await updateAppBinding(appId.value, binding.value.id, {
          expectedVersion: binding.value.version,
          overrideValues: inputValues,
          overrideEnabled: true,
          overrideMergeStrategy: mergeStrategy,
          overrideValuesYaml: inputYaml,
        })
        creating.value = false
      } else {
        config.value = await saveConfig(appId.value, {
          section: 'base', expectedVersion: config.value.version,
          chartConfig: { workloadKind: workloadKind.value, chartVersion: chartVersion.value },
          deployValues: inputValues, deployValuesYaml: inputYaml,
        })
        notifySetupChanged(appId.value)
      }
      saved.value = inputYaml
      savedStrategy.value = mergeStrategy
      MessagePlugin.success(isOverride.value ? `已保存 ${envName.value} 的环境覆盖` : '基础配置已保存')
    } catch (err) { handleError(err) }
    finally { saving.value = false }
  }

  async function removeOverride(): Promise<void> {
    if (!binding.value || saving.value) return
    saving.value = true
    try {
      binding.value = await updateAppBinding(appId.value, binding.value.id, {
        expectedVersion: binding.value.version, overrideValues: {}, overrideEnabled: false,
        overrideMergeStrategy: 'patch', overrideValuesYaml: '{}\n',
      })
      saved.value = '{}\n'
      savedStrategy.value = 'patch'
      resetDraft()
      deleteVisible.value = false
      selectTab('inherited')
      MessagePlugin.success('已删除环境覆盖，恢复继承基础配置')
    } catch (err) { handleError(err) }
    finally { saving.value = false }
  }

  const dryRunOutput = computed(() => {
    if (yamlError.value && (!isOverride.value || enabled.value)) return ''
    const values = effective.value
    const name = appName.value || 'app'
    const container = {
      name: 'app', image: `registry.example.com/${name}:<tag>`,
      ...(values.containerPort ? { ports: [{ containerPort: values.containerPort }] } : {}),
      ...(values.env ? { env: Object.entries(values.env).map(([key, value]) => ({ name: key, value })) } : {}),
    }
    return valuesYaml({
      apiVersion: workloadKind.value === 'Job' ? 'batch/v1' : 'apps/v1', kind: workloadKind.value,
      metadata: { name },
      spec: workloadKind.value === 'Job'
        ? { ...values.job, template: { spec: { restartPolicy: 'Never', containers: [container] } } }
        : { replicas: values.replicaCount ?? 1, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [container] } } },
    })
  })

  function confirmLeave(): Promise<boolean> | boolean {
    if (saving.value) return false
    if (!dirty.value) return true
    leaveVisible.value = true
    return new Promise((resolve) => { resolveLeave = resolve })
  }
  function finishLeave(leave: boolean): void {
    leaveVisible.value = false
    resolveLeave?.(leave)
    resolveLeave = undefined
  }
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = '' }
  }
  onBeforeRouteLeave(confirmLeave)
  onBeforeRouteUpdate((to, from) => to.path === from.path ? true : confirmLeave())
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => { ++loadToken; window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false) })
  watch([appId, envId], () => void load(), { immediate: true })
  watch(() => route.query.headerTab, applyTab)

  return {
    config, binding, envName, loading, error, conflict, saving, mode, tab, draft, strategy,
    creating, showMerged, workloadKind, chartVersion, deleteVisible, discardVisible, leaveVisible,
    isOverride, enabled, yamlError, dirty, editable, editorValue, chartText, versionText, dryRunOutput,
    selectTab, resetDraft, createOverride, changeStrategy, switchMode, load, save, removeOverride, finishLeave,
  }
}
