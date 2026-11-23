import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import { getConfigComparisonCatalog } from '@/api'
import type { ComparisonFile, ComparisonResourceType, ComparisonSelection, ConfigComparisonCatalog } from '@/types/configComparison'
import { comparisonEnvironmentName, comparisonEnvironmentOptions, comparisonFiles, comparisonInitialVersion, comparisonTypes, comparisonValue, comparisonVersionOptions, resolveComparisonSide } from '@/utils/configComparison'
import { resolveComparisonManifest } from '@/utils/configComparisonManifest'
import { hasScopedVariables, resolveVariableSide } from '@/utils/configVariables'

export function useConfigComparison() {
  const route = useRoute(), router = useRouter()
  const appId = computed(() => String(route.params.appId ?? ''))
  const projectId = computed(() => String(route.params.projectId ?? ''))
  const catalog = shallowRef<ConfigComparisonCatalog | null>(null)
  const loading = shallowRef(false), error = shallowRef('')
  const search = shallowRef(''), changedOnly = shallowRef(false), descending = shallowRef(false)
  const queryString = (key: string, fallback: string) => typeof route.query[key] === 'string' ? route.query[key] as string : fallback
  const leftSelection = computed<ComparisonSelection>(() => { const environment = queryString('left', 'base'); return { environment, version: queryString('leftVersion', comparisonInitialVersion(environment)) } })
  const rightSelection = computed<ComparisonSelection>(() => {
    const environment = queryString('right', leftSelection.value.environment === 'base' ? catalog.value?.bindings[0]?.environmentId ?? 'base' : leftSelection.value.environment)
    const previous = catalog.value ? comparisonVersionOptions(catalog.value, environment).find(item => item.value.startsWith('history:'))?.value : undefined
    return { environment, version: queryString('rightVersion', previous ?? comparisonInitialVersion(environment)) }
  })
  const blank = { label: '', document: null, error: '', notice: '' }
  const rawLeft = computed(() => catalog.value ? resolveComparisonSide(catalog.value, leftSelection.value) : blank)
  const rawRight = computed(() => catalog.value ? resolveComparisonSide(catalog.value, rightSelection.value) : blank)
  const showVariables = computed(() => route.query.resolveVariables === '1')
  const hasVariables = computed(() => hasScopedVariables(rawLeft.value.document) || hasScopedVariables(rawRight.value.document))
  const left = computed(() => resolveVariableSide(rawLeft.value, showVariables.value && tab.value === 'configuration'))
  const right = computed(() => resolveVariableSide(rawRight.value, showVariables.value && tab.value === 'configuration'))
  const environmentOptions = computed(() => catalog.value ? comparisonEnvironmentOptions(catalog.value) : [])
  const leftVersions = computed(() => catalog.value ? comparisonVersionOptions(catalog.value, leftSelection.value.environment) : [])
  const rightVersions = computed(() => catalog.value ? comparisonVersionOptions(catalog.value, rightSelection.value.environment) : [])
  const resourceType = computed(() => String(route.params.resourceType ?? 'deployment') as ComparisonResourceType)
  const resourceName = computed(() => String(route.params.resourceName ?? ''))
  const tab = computed(() => resourceType.value === 'manifest' ? 'manifest' : 'configuration')
  const leftManifest = computed(() => resolveComparisonManifest(resolveVariableSide(rawLeft.value, true)))
  const rightManifest = computed(() => resolveComparisonManifest(resolveVariableSide(rawRight.value, true)))
  const files = computed<ComparisonFile[]>(() => tab.value === 'manifest'
    ? [{ key: 'manifest', type: 'manifest', name: '', label: 'Manifest Output', changed: !leftManifest.value.error && !rightManifest.value.error && leftManifest.value.text !== rightManifest.value.text, added: false, removed: false }]
    : comparisonFiles(left.value, right.value))
  const visibleFiles = computed(() => tab.value === 'manifest' ? files.value : files.value.filter(item => (!changedOnly.value || item.changed) && `${item.label} ${item.type}`.toLowerCase().includes(search.value.trim().toLowerCase())).sort((a, b) => (descending.value ? -1 : 1) * a.label.localeCompare(b.label)))
  const selectedFile = computed(() => files.value.find(item => item.type === resourceType.value && item.name === resourceName.value))
  const selectionError = computed(() => resourceType.value === 'manifest' ? resourceName.value ? 'Manifest Output 不包含子文件，请重新选择。' : '' : !comparisonTypes.includes(resourceType.value) ? '配置类型无效，请从左侧选择配置。' : !selectedFile.value && left.value.document && right.value.document ? '所选配置在两侧版本中均不存在，请重新选择。' : '')
  const leftValue = computed(() => comparisonValue(left.value, resourceType.value, resourceName.value))
  const rightValue = computed(() => comparisonValue(right.value, resourceType.value, resourceName.value))
  const heading = computed(() => catalog.value ? `对比 ${comparisonEnvironmentName(catalog.value, leftSelection.value.environment)}` : '配置对比')
  let generation = 0
  async function load(): Promise<void> {
    const token = ++generation, id = appId.value
    loading.value = true; error.value = ''
    if (catalog.value?.config.appId !== id) catalog.value = null
    try {
      const value = await getConfigComparisonCatalog(id)
      if (token !== generation) return
      catalog.value = value
    } catch (err) { if (token === generation) error.value = err instanceof Error ? err.message : '加载配置失败' }
    finally { if (token === generation) loading.value = false }
  }
  function updateSide(side: 'left' | 'right', selection: ComparisonSelection): void {
    void router.push({ query: { ...route.query, [side]: selection.environment, [`${side}Version`]: selection.version } })
  }
  function swap(): void {
    const lhs = leftSelection.value, rhs = rightSelection.value
    void router.push({ query: { ...route.query, left: rhs.environment, leftVersion: rhs.version, right: lhs.environment, rightVersion: lhs.version } })
  }
  function toggleVariables(value: boolean): void {
    void router.push({ query: { ...route.query, resolveVariables: value ? '1' : undefined } })
  }
  function selectFile(type: ComparisonResourceType, name = ''): void {
    void router.push({ name: 'config-compare', params: { projectId: projectId.value, appId: appId.value, resourceType: type, resourceName: name || undefined }, query: { ...route.query } })
  }
  function selectTab(value: 'configuration' | 'manifest'): void {
    if (value === tab.value) return
    void router.push({ name: 'config-compare', params: { projectId: projectId.value, appId: appId.value, resourceType: value === 'manifest' ? 'manifest' : 'deployment' },
      query: { ...route.query, returnType: route.query.returnType ?? (comparisonTypes.includes(resourceType.value) ? resourceType.value : 'deployment'), returnName: route.query.returnName ?? resourceName.value },
    })
  }
  const backTarget = computed(() => {
    if (route.query.returnTo === 'deployment') {
      const id = queryString('returnRun', '')
      const deployment = catalog.value?.deployments.find(item => item.id === id)
      const binding = catalog.value?.bindings.find(item => item.id === deployment?.bindingId)
      return { name: 'app-deployments', params: { projectId: projectId.value, appId: appId.value }, query: { env: binding?.environmentId, deployment: deployment?.id, tab: 'config' } }
    }
    const env = queryString('returnEnv', leftSelection.value.environment)
    const sourceType = queryString('returnType', resourceType.value) as ComparisonResourceType
    const kind = comparisonTypes.includes(sourceType) ? sourceType : 'deployment'
    const validEnv = catalog.value?.bindings.some(item => item.environmentId === env)
    return { name: `config-${validEnv ? 'override' : 'base'}-${kind}`, params: { projectId: projectId.value, appId: appId.value, ...(validEnv ? { envId: env } : {}) }, query: kind === 'deployment' ? {} : { entry: queryString('returnName', resourceName.value) || undefined } }
  })
  watch([catalog, () => route.fullPath], () => {
    if (!catalog.value) return
    const lhs = leftSelection.value, rhs = rightSelection.value
    const defaults: LocationQueryRaw = { ...route.query, left: lhs.environment, leftVersion: lhs.version, right: rhs.environment, rightVersion: rhs.version }
    const missingQuery = ['left', 'leftVersion', 'right', 'rightVersion'].some(key => route.query[key] === undefined)
    const first = !resourceName.value && ['configmaps', 'secrets'].includes(resourceType.value) ? files.value.find(item => item.type === resourceType.value) : undefined
    if (missingQuery || first) void router.replace({ name: 'config-compare', params: { ...route.params, resourceName: (first?.name ?? resourceName.value) || undefined }, query: defaults })
  })
  watch(appId, load, { immediate: true })
  onBeforeUnmount(() => { generation++ })
  return { catalog, loading, error, load, heading, search, changedOnly, descending, leftSelection, rightSelection, left, right, environmentOptions, leftVersions, rightVersions, resourceType, resourceName, files, visibleFiles, selectedFile, selectionError, leftValue, rightValue, leftManifest, rightManifest, tab, selectTab, updateSide, swap, selectFile, backTarget, showVariables, hasVariables, toggleVariables }
}
