import type { K8sResource } from '@/types'

export interface TreeNode {
  key: string
  kind: string
  name: string
  status: string
  healthy: boolean
  resource: K8sResource
  children: TreeNode[]
  containers: string[]
  /** Service 的访问地址（Devtron 的 URL 列） */
  url?: string
}

export const HEALTHY_STATUSES = [
  'Healthy',
  'Running',
  'Available',
  'Active',
  'Ready',
  'Succeeded',
  'Completed',
  'Bound',
  'Complete',
]

/** 部分类型在列表里显示 Events 入口 */
export const EVENT_KINDS = ['Pod', 'Ingress', 'Service', 'ConfigMap', 'Secret', 'Job']

export function serviceUrl(resource: K8sResource): string | undefined {
  if (resource.kind !== 'Service') return undefined
  const port = /^\s*-\s*port:\s*(\d+)/m.exec(resource.manifest ?? '')?.[1]
  const namespace = resource.ref.namespace
  const name = resource.ref.name
  return port ? `${name}.${namespace}:${port}` : `${name}.${namespace}`
}

export function parseContainers(resource: K8sResource): string[] {
  return [...(resource.manifest ?? '').matchAll(/^\s*- name:\s*(\S+)/gm)].map((match) => match[1])
}
