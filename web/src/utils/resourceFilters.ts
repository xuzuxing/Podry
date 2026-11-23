import type { K8sResource, NodeDetail } from '@/types'
import { resourceBody } from './resourceListing'

export const NODE_FILTER_KEYS = ['label', 'nodeGroup', 'k8sVersion'] as const
export type NodeFilterKey = typeof NODE_FILTER_KEYS[number]
export type NodeFilters = Record<NodeFilterKey, string[]>
export interface NodeFilterData { name: string; labels: Record<string, string>; nodeGroup: string; k8sVersion: string }
export interface KindSearchOption { key: string; label: string; description: string; resource: string; group: string; shortNames?: string[] }

export function queryText(value: unknown): string {
  return String((Array.isArray(value) ? value[0] : value) ?? '')
}
export function filterValues(value: unknown): string[] {
  return [...new Set(queryText(value).split(',').map(part => part.trim()).filter(Boolean))]
}
export function readNodeFilters(query: Record<string, unknown>): NodeFilters {
  return { label: filterValues(query.label), nodeGroup: filterValues(query.nodeGroup), k8sVersion: filterValues(query.k8sVersion) }
}
export function nodeGroupLabel(labels: Record<string, string>): string {
  return labels['eks.amazonaws.com/nodegroup'] || labels['cloud.google.com/gke-nodepool'] || labels['kubernetes.azure.com/agentpool'] || ''
}
export function nodeFilterData(item: K8sResource, node?: NodeDetail): NodeFilterData {
  const manifest = resourceBody(item.manifest), detail = resourceBody(node?.manifest ?? '')
  const labels: Record<string, string> = {}
  for (const entry of node?.labels ?? []) {
    const index = entry.indexOf('=')
    if (index > 0) labels[entry.slice(0, index)] = entry.slice(index + 1)
  }
  for (const source of [detail.metadata?.labels, manifest.metadata?.labels]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    for (const [key, value] of Object.entries(source)) if (typeof value === 'string' || typeof value === 'number') labels[key] = String(value)
  }
  return { name: item.ref.name, labels, nodeGroup: nodeGroupLabel(labels), k8sVersion: node?.k8sVersion ?? manifest.status?.nodeInfo?.kubeletVersion ?? detail.status?.nodeInfo?.kubeletVersion ?? '' }
}
export function matchesNodeFilters(node: NodeFilterData, filters: NodeFilters, search = ''): boolean {
  const labels = filters.label.filter(Boolean), groups = filters.nodeGroup.filter(Boolean), versions = filters.k8sVersion.filter(Boolean)
  return node.name.toLowerCase().includes(search.trim().toLowerCase())
    && (!labels.length || labels.some(label => {
      const index = label.indexOf('=')
      return index > 0 && Object.hasOwn(node.labels, label.slice(0, index)) && node.labels[label.slice(0, index)] === label.slice(index + 1)
    }))
    && (!groups.length || groups.includes(node.nodeGroup))
    && (!versions.length || versions.includes(node.k8sVersion))
}
export function nodeFilterOptions(nodes: NodeFilterData[]): NodeFilters {
  const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return {
    label: sorted(nodes.flatMap(node => Object.entries(node.labels).map(([key, value]) => `${key}=${value}`))),
    nodeGroup: sorted(nodes.map(node => node.nodeGroup)), k8sVersion: sorted(nodes.map(node => node.k8sVersion)),
  }
}
export function searchKinds(options: KindSearchOption[], text: string): KindSearchOption[] {
  const search = text.trim().toLowerCase()
  if (!search) return []
  const exact = (option: KindSearchOption) => option.shortNames?.some(name => name.toLowerCase() === search) ? 1 : 0
  return options.filter(option => `${option.label} ${option.resource} ${option.group} ${option.description} ${(option.shortNames ?? []).join(' ')}`.toLowerCase().includes(search))
    .sort((a, b) => exact(b) - exact(a))
}
