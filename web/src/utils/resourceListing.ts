import { parseDocument } from 'yaml'
import type { K8sResource, NodeDetail, ResourceType } from '@/types'
import type { ResourceColumn, ResourceRow } from '@/components/resource/listTypes'
import { fmtRelative } from './format'

export const resourceTypeKey = (type: { group: string; resource: string }): string => `${type.group || 'core'}/${type.resource}`
export const normalizeResourceGroup = (value: unknown): string => ['core', '_', ''].includes(String(value ?? '')) ? '' : String(value)

export function resolveResourceType(types: ResourceType[], resource: string, group?: string): ResourceType | undefined {
  return group === undefined ? types.find(type => type.resource === resource) : types.find(type => type.resource === resource && type.group === group)
}

type Body = Record<string, any>
const object = (value: unknown): Body => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const objects = (value: unknown): Body[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
export function resourceBody(manifest: string): Body {
  try {
    const document = parseDocument(manifest)
    if (document.errors.length) return {}
    const value = document.toJS({ maxAliasCount: 100 })
    return value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {}
  } catch { return {} }
}

const column = (key: string, label: string, width = 125, mandatory = false): ResourceColumn => ({ key, label, width, mandatory })
const NAME = column('name', '名称', 285, true), STATUS = column('status', '状态', 145), AGE = column('age', '存活时间', 115)
/** 内置字段按 API group 匹配，避免把同名 CRD 当成内置资源。 */
const COLUMNS: Record<string, ResourceColumn[]> = {
  'core/nodes': [NAME, { ...STATUS, width: 235, mandatory: true }, column('roles', '角色'), column('errorCount', '错误', 80, true), column('cpu', 'CPU 使用率', 160), column('memory', '内存使用率', 160), column('version', 'K8s 版本'), column('nodeGroup', '节点组'), column('pods', 'Pods', 80), column('taints', 'Taints', 80), AGE, column('unschedulable', '禁止调度')],
  'core/pods': [NAME, column('ready', '就绪', 80), STATUS, column('restarts', '重启', 80), column('node', '节点', 160), AGE],
  'apps/deployments': [NAME, column('ready', '就绪'), column('updated', '最新副本'), column('available', '可用副本'), AGE],
  'apps/statefulsets': [NAME, column('ready', '就绪'), AGE],
  'apps/replicasets': [NAME, column('desired', '期望副本'), column('current', '当前副本'), column('ready', '就绪'), AGE],
  'apps/daemonsets': [NAME, column('desired', '期望节点'), column('current', '当前节点'), column('ready', '就绪'), column('available', '可用节点'), AGE],
  'core/services': [NAME, column('type', '类型'), column('clusterIP', 'Cluster IP', 150), column('externalIP', 'External IP', 150), column('ports', '端口', 160), AGE],
  'networking.k8s.io/ingresses': [NAME, column('class', 'Class'), column('hosts', 'Hosts', 200), column('address', 'Address', 180), AGE],
  'core/configmaps': [NAME, column('keys', 'Data', 90), AGE],
  'core/secrets': [NAME, column('type', '类型', 210), column('keys', 'Data', 90), AGE],
  'core/persistentvolumeclaims': [NAME, STATUS, column('volume', 'Volume', 180), column('capacity', '容量'), column('accessModes', '访问模式'), column('storageClass', 'Storage Class'), AGE],
  'core/persistentvolumes': [NAME, column('capacity', '容量'), column('accessModes', '访问模式'), column('reclaimPolicy', '回收策略'), STATUS, column('claim', 'Claim', 180), column('storageClass', 'Storage Class'), AGE],
  'storage.k8s.io/storageclasses': [NAME, column('provisioner', 'Provisioner', 230), column('reclaimPolicy', '回收策略'), column('bindingMode', 'Volume Binding Mode', 210), column('expansion', '允许扩容'), AGE],
  'batch/jobs': [NAME, column('completions', '完成数'), column('duration', '耗时'), AGE],
  'batch/cronjobs': [NAME, column('schedule', 'Schedule', 170), column('suspend', 'Suspend'), column('active', 'Active'), column('lastSchedule', 'Last Schedule', 150), AGE],
  'core/serviceaccounts': [NAME, column('secrets', 'Secrets'), AGE],
  'rbac.authorization.k8s.io/rolebindings': [NAME, column('role', 'Role', 220), AGE],
  'rbac.authorization.k8s.io/clusterrolebindings': [NAME, column('role', 'Role', 220), AGE],
  'apiextensions.k8s.io/customresourcedefinitions': [NAME, column('group', 'Group', 200), column('customKind', 'Kind', 140), column('scope', 'Scope'), column('versions', 'Versions', 170), STATUS, AGE],
}

export function resourceColumns(type: ResourceType | null): ResourceColumn[] {
  if (!type) return [NAME, STATUS, AGE]
  const base = COLUMNS[resourceTypeKey(type)] ?? (type.printerColumns?.length ? [NAME, ...type.printerColumns.map((item, index) => column(`printer:${index}`, item.name, 145)), AGE] : [NAME, STATUS, AGE])
  const columns = [...base]
  if (type.namespaced) columns.splice(1, 0, column('namespace', '命名空间', 155))
  return columns
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map(display).join(', ') : '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** 只读取简单点路径与数字下标；不执行表达式、不把复杂 JSONPath 伪装成支持。 */
export function printerValue(body: Body, path: string): unknown {
  if (!/^\.(?:[A-Za-z_][\w-]*)(?:(?:\.[A-Za-z_][\w-]*)|(?:\[\d+\]))*$/.test(path)) return undefined
  return path.slice(1).replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Body)[key] : undefined, body)
}

export function resourceListRow(item: K8sResource, type: ResourceType | null, node?: NodeDetail): ResourceRow {
  const body = resourceBody(item.manifest), spec = object(body.spec), status = object(body.status), metadata = object(body.metadata)
  const createdAt = metadata.creationTimestamp ? Date.parse(metadata.creationTimestamp) : NaN
  const condition = objects(status.conditions).find(entry => entry.type === 'Established')
  const ready = objects(status.containerStatuses).filter(entry => entry.ready === true).length
  const join = (values: unknown[]) => values.length ? values : undefined
  const addresses = objects(status.loadBalancer?.ingress).map(entry => entry.ip ?? entry.hostname).filter(Boolean)
  const cpu = node?.resources.find(entry => entry.name === 'cpu'), memory = node?.resources.find(entry => entry.name === 'memory')
  const values: Body = {
    ready: item.kind === 'Pod' ? (Array.isArray(status.containerStatuses) && objects(spec.containers).length ? `${ready}/${objects(spec.containers).length}` : undefined) : status.readyReplicas === undefined ? undefined : `${status.readyReplicas}/${spec.replicas ?? 1}`,
    restarts: Array.isArray(status.containerStatuses) ? objects(status.containerStatuses).reduce((sum, entry) => sum + (Number(entry.restartCount) || 0), 0) : undefined,
    node: spec.nodeName, desired: spec.replicas ?? status.desiredNumberScheduled, current: status.replicas ?? status.currentNumberScheduled,
    updated: status.updatedReplicas, available: status.availableReplicas ?? status.numberAvailable,
    type: body.type ?? spec.type, clusterIP: spec.clusterIP, externalIP: join([...array(spec.externalIPs), ...addresses]),
    ports: objects(spec.ports).map(port => `${port.port}${port.nodePort ? `:${port.nodePort}` : ''}/${port.protocol ?? 'TCP'}`),
    class: spec.ingressClassName ?? metadata.annotations?.['kubernetes.io/ingress.class'], hosts: objects(spec.rules).map(rule => rule.host ?? '*'), address: join(addresses),
    keys: Object.keys({ ...object(body.data), ...object(body.binaryData), ...object(body.stringData) }).length,
    capacity: status.capacity?.storage ?? spec.capacity?.storage, accessModes: status.accessModes ?? spec.accessModes,
    volume: spec.volumeName, storageClass: spec.storageClassName, reclaimPolicy: spec.persistentVolumeReclaimPolicy ?? body.reclaimPolicy,
    claim: spec.claimRef ? `${spec.claimRef.namespace}/${spec.claimRef.name}` : undefined,
    provisioner: body.provisioner, bindingMode: body.volumeBindingMode, expansion: body.allowVolumeExpansion,
    completions: status.succeeded === undefined ? undefined : `${status.succeeded}/${spec.completions ?? 1}`,
    duration: status.startTime && status.completionTime ? Math.max(0, (Date.parse(status.completionTime) - Date.parse(status.startTime)) / 1000) : undefined,
    schedule: spec.schedule, suspend: spec.suspend, active: status.active?.length, lastSchedule: status.lastScheduleTime ? fmtRelative(status.lastScheduleTime) : undefined,
    secrets: body.secrets?.length, role: body.roleRef ? `${body.roleRef.kind}/${body.roleRef.name}` : undefined,
    group: spec.group, customKind: spec.names?.kind, scope: spec.scope, versions: objects(spec.versions).filter(entry => entry.served).map(entry => entry.name),
    roles: node?.roles ?? join(Object.keys(metadata.labels ?? {}).filter(key => key.startsWith('node-role.kubernetes.io/')).map(key => key.split('/')[1])), errorCount: node ? node.conditions.filter(entry => entry.haveIssue).length : undefined,
    cpu: cpu?.usagePercentage, memory: memory?.usagePercentage,
    cpuAbsolute: cpu?.usage, memoryAbsolute: memory?.usage, cpuAllocatable: cpu?.allocatable, memoryAllocatable: memory?.allocatable,
    version: node?.k8sVersion ?? status.nodeInfo?.kubeletVersion, nodeGroup: metadata.labels?.['eks.amazonaws.com/nodegroup'] ?? metadata.labels?.['cloud.google.com/gke-nodepool'] ?? metadata.labels?.['kubernetes.azure.com/agentpool'],
    pods: node?.pods.length, taints: spec.taints?.length ?? (item.kind === 'Node' ? 0 : undefined), unschedulable: spec.unschedulable ?? (item.kind === 'Node' ? false : undefined),
  }
  // 旧 Mock 没有 status 子树时只使用明确记录的 summary，不推断 Running=1/1。
  const summaryReady = /\b(\d+\s*\/\s*\d+)\b/.exec(item.summary)?.[1]?.replace(/\s/g, '')
  if (values.ready === undefined && summaryReady) values.ready = summaryReady
  if (values.restarts === undefined) values.restarts = /重启\s*(\d+)/.exec(item.summary)?.[1]
  type?.printerColumns?.forEach((entry, index) => { values[`printer:${index}`] = printerValue(body, entry.jsonPath) })
  const sortValues: NonNullable<ResourceRow['sortValues']> = { age: Number.isFinite(createdAt) ? Date.now() - createdAt : null }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) sortValues[key] = null
    else if (key === 'lastSchedule') sortValues[key] = Date.now() - Date.parse(status.lastScheduleTime)
    else if (key === 'cpu' || key === 'memory' || key === 'restarts') sortValues[key] = Number.parseFloat(value)
    else if (typeof value === 'number') sortValues[key] = value
  }
  return {
    id: item.ref.uid, name: item.ref.name, namespace: item.ref.namespace, kind: item.kind, group: item.ref.group,
    status: item.kind === 'Node' && node ? `${node.status}${node.unschedulable ? ', SchedulingDisabled' : ''}` : condition ? (condition.status === 'True' ? 'Established' : 'NotEstablished') : item.status,
    age: Number.isFinite(createdAt) ? fmtRelative(metadata.creationTimestamp) : '—',
    fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, display(value)])), sortValues,
  }
}

export function compareResourceRows(a: ResourceRow, b: ResourceRow, key: string, descending = false): number {
  const value = (row: ResourceRow) => row.sortValues && Object.hasOwn(row.sortValues, key) ? row.sortValues[key] : String(['name', 'namespace', 'status', 'age'].includes(key) ? row[key as keyof ResourceRow] : row.fields[key] ?? '')
  const left = value(a), right = value(b)
  const empty = (item: unknown) => item === null || item === undefined || item === '—' || (typeof item === 'number' && !Number.isFinite(item))
  if (empty(left) || empty(right)) return empty(left) === empty(right) ? 0 : empty(left) ? 1 : -1
  const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })
  return result * (descending ? -1 : 1)
}
