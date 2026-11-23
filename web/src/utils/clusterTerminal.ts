import { parseDocument, stringify } from 'yaml'
import type { K8sResource, NodePodRow, NodeTaint, ResourceEvent } from '@/types'
import { resourceYamlDocuments, validateResourceEdit } from './resourceManifest'

export const AUTO_NODE = 'autoSelectNode'
export const CLUSTER_SHELLS = ['bash', 'sh'] as const
export interface ClusterTerminalSelection { node: string; namespace: string; image: string; shell: 'bash' | 'sh' }
// 上游镜像目录来自服务端配置；这里只提供明确的本地示例，不假定上游目录内容。
export const CLUSTER_TERMINAL_IMAGES = [
  { label: 'BusyBox', value: 'busybox:1.36' },
  { label: 'Network tools · netshoot', value: 'nicolaka/netshoot:v0.13' },
]
export function terminalSelection(query: Record<string, unknown>, nodes: string[], namespaces: string[]): ClusterTerminalSelection {
  const value = (key: string) => typeof query[key] === 'string' ? String(query[key]) : ''
  return {
    node: nodes.includes(value('node')) ? value('node') : AUTO_NODE,
    namespace: value('namespace') || (namespaces.includes('default') ? 'default' : namespaces[0] || 'default'),
    image: value('image') || CLUSTER_TERMINAL_IMAGES[0]!.value,
    shell: value('shell') === 'sh' ? 'sh' : 'bash',
  }
}
export function terminalSelectionError(selection: ClusterTerminalSelection): string {
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(selection.namespace)) return '命名空间需要符合 Kubernetes 名称格式（最多 63 个字符）'
  if (!selection.image || /\s|[;&|`$<>]/.test(selection.image) || selection.image.length > 255) return '请输入有效的公开容器镜像路径'
  return ''
}
export function createDebugPod(selection: ClusterTerminalSelection, node: string, debug: boolean, sequence: number, taints: NodeTaint[] = []): K8sResource {
  const name = `podry-debug-${sequence}`
  const container = debug ? 'debugger' : 'podry-debug-terminal'
  const body = {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { name, namespace: selection.namespace, labels: { 'app.kubernetes.io/name': 'podry-debug' }, managedFields: [{ manager: 'podry-mock', operation: 'Update' }] },
    spec: {
      nodeName: node, restartPolicy: 'Never',
      ...(taints.length ? { tolerations: taints.map(taint => ({ ...taint, operator: taint.value ? 'Equal' : 'Exists' })) } : {}),
      ...(debug ? { hostPID: true, hostNetwork: true, hostIPC: true, volumes: [{ name: 'host-root', hostPath: { path: '/' } }] } : {}),
      containers: [{ name: container, image: selection.image, command: [selection.shell], stdin: true, tty: true,
        ...(debug ? { securityContext: { privileged: true }, volumeMounts: [{ name: 'host-root', mountPath: '/host' }] } : {}),
      }],
    },
  }
  return { ref: { group: '', version: 'v1', resource: 'pods', namespace: selection.namespace, name, uid: `mock-debug-${sequence}` }, kind: 'Pod', status: 'Running', summary: '本地调试 Pod', ownerRefs: [], appId: null, manifest: stringify(body) }
}
export function validateDebugManifest(text: string, resource: K8sResource): string {
  const identityError = validateResourceEdit(text, resource)
  if (identityError) return identityError
  try {
    const body = resourceYamlDocuments(text)[0]!.toJS({ maxAliasCount: 100 })
    const previous = parseDocument(resource.manifest).toJS()
    if (body.spec?.nodeName !== previous.spec?.nodeName) return '请使用节点选择器切换目标节点'
    if (!Array.isArray(body.spec?.containers) || !body.spec.containers.length) return '调试 Pod 至少需要一个容器'
    if (body.spec.containers.some((item: { name?: unknown; image?: unknown }) => typeof item?.name !== 'string' || !item.name || typeof item.image !== 'string' || !item.image)) return '每个容器需要有效的 name 和 image'
    if (new Set(body.spec.containers.map((item: { name: string }) => item.name)).size !== body.spec.containers.length) return '容器名称不能重复'
    return ''
  } catch (cause) { return cause instanceof Error ? cause.message : 'Manifest 无法解析' }
}
export function debugPodEvents(resource: K8sResource, node: string, at: string): ResourceEvent[] {
  return [
    ['Scheduled', `Successfully assigned ${resource.ref.namespace}/${resource.ref.name} to ${node}`],
    ['Pulled', 'Container image is available (local Mock)'],
    ['Created', 'Created debug container (local Mock)'],
    ['Started', 'Started debug container (local Mock)'],
  ].map(([reason, message]) => ({ type: 'Normal', reason: reason!, message: message!, count: 1, firstSeenAt: at, lastSeenAt: at }))
}
export function sortedNodePods(pods: NodePodRow[], key: keyof NodePodRow, descending: boolean): NodePodRow[] {
  const age = (value: string) => { const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(value); return match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]!] ?? 1) : 0 }
  return [...pods].sort((a, b) => {
    const diff = key === 'age' ? age(a.age) - age(b.age) : ['cpuRequest', 'cpuLimit', 'memRequest', 'memLimit'].includes(key) ? (parseFloat(a[key]) || 0) - (parseFloat(b[key]) || 0) : a[key].localeCompare(b[key])
    return (diff || a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace)) * (descending ? -1 : 1)
  })
}
