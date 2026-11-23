import type { Deployment } from '@/types'
import type { ComparisonFile, ComparisonOption, ComparisonResourceType, ComparisonSelection, ComparisonSide, ConfigComparisonCatalog } from '@/types/configComparison'
import { effectiveValues } from './deploymentValues'
import { effectiveEntries } from './configEntries'
import { configDocument as document } from './configDocument'
import { fmtTime } from './format'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const comparisonTypes: ComparisonResourceType[] = ['deployment', 'configmaps', 'secrets']
export const comparisonTypeLabels = { deployment: '部署模板', configmaps: 'ConfigMaps', secrets: 'Secrets', manifest: 'Manifest Output' }
export function comparisonEnvironmentName(catalog: ConfigComparisonCatalog, id: string): string {
  const chart = catalog.chartDefaults.find(item => item.id === id)
  if (chart) return `${chart.chartConfig.workloadKind} v${chart.chartConfig.chartVersion} (Default)`
  return id === 'base' ? '基础配置（Base）' : catalog.environments.find(item => item.id === id)?.name ?? id
}
export function comparisonEnvironmentOptions(catalog: ConfigComparisonCatalog): ComparisonOption[] {
  return [{ label: '基础配置（Base）', value: 'base' }, ...[...new Set(catalog.bindings.filter(item => item.appId === catalog.config.appId).map(item => item.environmentId))].map(id => ({ label: comparisonEnvironmentName(catalog, id), value: id })), ...catalog.chartDefaults.map(item => ({ label: comparisonEnvironmentName(catalog, item.id), value: item.id }))]
}
export function comparisonInitialVersion(environment: string): string { return environment.startsWith('chart:') ? 'default' : 'saved' }
function deploymentsFor(catalog: ConfigComparisonCatalog, environment: string): Deployment[] {
  const bindings = new Set(catalog.bindings.filter(item => item.appId === catalog.config.appId && item.environmentId === environment).map(item => item.id))
  return catalog.deployments.filter(item => item.appId === catalog.config.appId && bindings.has(item.bindingId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
export function comparisonVersionOptions(catalog: ConfigComparisonCatalog, environment: string): ComparisonOption[] {
  if (catalog.chartDefaults.some(item => item.id === environment)) return [{ label: 'Chart 默认值', value: 'default' }]
  if (environment !== 'base' && !catalog.bindings.some(item => item.environmentId === environment)) return []
  const options = [{ label: '当前已保存配置', value: 'saved' }]
  if (environment === 'base') return options
  options.push({ label: '当前部署快照', value: 'deployed' })
  return [...options, ...deploymentsFor(catalog, environment).map(item => ({
    label: `历史发布 #${item.helmRevision ?? '—'} · v${item.configVersion} · ${fmtTime(item.createdAt)}${item.configSnapshot ? '' : ' · 缺少快照'}`,
    value: `history:${item.id}`,
  }))]
}

export function resolveComparisonSide(catalog: ConfigComparisonCatalog, selection: ComparisonSelection): ComparisonSide {
  const environmentLabel = comparisonEnvironmentName(catalog, selection.environment)
  const result: ComparisonSide = { label: environmentLabel, document: null, error: '', notice: '' }
  const chart = catalog.chartDefaults.find(item => item.id === selection.environment)
  if (chart) return selection.version === 'default'
    ? { ...result, document: document(chart.values, [], []), manifestContext: { chartConfig: clone(chart.chartConfig), target: null, workloadName: catalog.applicationName, imageRef: null }, notice: 'Chart 默认值 · 本地示例目录，不包含应用或环境覆盖。' }
    : { ...result, error: 'Chart 默认值没有应用发布版本，请重新选择。' }
  const binding = catalog.bindings.find(item => item.appId === catalog.config.appId && item.environmentId === selection.environment)
  if (selection.environment !== 'base' && !binding) return { ...result, error: '此应用尚未绑定所选环境，请重新选择。' }
  if (selection.version === 'saved') {
    const maps = catalog.configMaps.filter(item => item.appId === catalog.config.appId)
    const secrets = catalog.secrets.filter(item => item.appId === catalog.config.appId)
    const baseMaps = maps.filter(item => !item.environmentId), baseSecrets = secrets.filter(item => !item.environmentId)
    return { ...result, variableSnapshot: catalog.variableSnapshots?.[selection.environment], label: `${environmentLabel} · 当前已保存配置`, document: document(
      effectiveValues(catalog.config.deployValues, binding),
      binding ? effectiveEntries(baseMaps, maps.filter(item => item.environmentId === selection.environment)) : baseMaps,
      binding ? effectiveEntries(baseSecrets, secrets.filter(item => item.environmentId === selection.environment)) : baseSecrets,
    ), manifestContext: { chartConfig: clone(catalog.config.chartConfig), target: clone(binding?.target ?? null), workloadName: catalog.applicationName, imageRef: null }, notice: `配置 v${catalog.config.version}；显示继承与覆盖合并后的已保存值，不包含编辑器中未保存的草稿。` }
  }
  const isCurrent = selection.version === 'deployed'
  if (!isCurrent && !selection.version.startsWith('history:')) return { ...result, error: '配置版本无效，请重新选择。' }
  if (!binding) return { ...result, error: '基础配置没有部署历史，请选择当前已保存配置。' }
  const id = isCurrent ? binding.currentDeploymentId : selection.version.slice('history:'.length)
  const deployment = deploymentsFor(catalog, selection.environment).find(item => item.id === id)
  if (!deployment) return { ...result, error: isCurrent ? '此环境尚无当前部署记录。' : '发布记录不存在或不属于所选应用和环境。' }
  const label = `${environmentLabel} · ${isCurrent ? '当前部署' : '历史发布'} #${deployment.helmRevision ?? '—'} · v${deployment.configVersion}`
  const snapshot = deployment.configSnapshot
  if (!snapshot) return { ...result, label, error: '该发布记录未保存配置快照，无法还原当时配置。', deploymentId: deployment.id }
  return { ...result, label, document: document(snapshot.values, snapshot.configMaps, snapshot.secrets), variableSnapshot: snapshot.variableSnapshot ? clone(snapshot.variableSnapshot) : undefined, deploymentId: deployment.id,
    manifestContext: { chartConfig: clone(snapshot.chartConfig ?? null), target: clone(snapshot.target ?? null), workloadName: snapshot.target?.releaseName ?? '', imageRef: deployment.imageRef || null },
    notice: `${snapshot.source === 'fixture' ? '本地示例快照' : '发布触发时快照'} · ${fmtTime(snapshot.capturedAt)}` }
}

/** 排序对象键但保留类型与数组顺序，避免键顺序或字符串化造成误判。 */
export function comparableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparableValue).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${comparableValue(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
export function comparisonValue(side: ComparisonSide, type: ComparisonResourceType, name: string): Record<string, unknown> {
  return type === 'deployment' ? side.document?.values ?? {} : type === 'manifest' ? {} : side.document?.[type][name] ?? {}
}
export function comparisonFiles(left: ComparisonSide, right: ComparisonSide): ComparisonFile[] {
  if (!left.document || !right.document) return []
  const file = (type: Exclude<ComparisonResourceType, 'manifest'>, name: string): ComparisonFile => {
    const lhs = type === 'deployment' ? left.document!.values : left.document![type][name]
    const rhs = type === 'deployment' ? right.document!.values : right.document![type][name]
    return { key: JSON.stringify([type, name]), type, name, label: name || '部署模板', changed: comparableValue(lhs) !== comparableValue(rhs), added: lhs === undefined, removed: rhs === undefined }
  }
  return [file('deployment', ''), ...(['configmaps', 'secrets'] as const).flatMap(type => [...new Set([...Object.keys(left.document![type]), ...Object.keys(right.document![type])])].sort().map(name => file(type, name)))]
}

export function configurationDiffRows(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leaves = (value: unknown, path = ''): Record<string, unknown> => {
    if (value !== null && typeof value === 'object' && Object.keys(value).length) {
      return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        const segment = Array.isArray(value) ? `[${key}]` : /^[a-zA-Z_$][\w$-]*$/.test(key) ? `${path ? '.' : ''}${key}` : `[${JSON.stringify(key)}]`
        return Object.entries(leaves(item, path + segment))
      }))
    }
    return path ? { [path]: value } : {}
  }
  const lhs = leaves(left), rhs = leaves(right)
  const display = (value: unknown) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value === null ? 'null' : String(value)
  return [...new Set([...Object.keys(lhs), ...Object.keys(rhs)])].sort().map(key => ({
    key, left: Object.hasOwn(lhs, key) ? display(lhs[key]) : '—', right: Object.hasOwn(rhs, key) ? display(rhs[key]) : '—',
    changed: comparableValue(Object.hasOwn(lhs, key) ? lhs[key] : undefined) !== comparableValue(Object.hasOwn(rhs, key) ? rhs[key] : undefined), added: !Object.hasOwn(lhs, key), removed: !Object.hasOwn(rhs, key),
  }))
}
