import { parseDocument } from 'yaml'
import type { NodeDetail } from '@/types'

export function nodeManifestError(body: { metadata?: { labels?: unknown; annotations?: unknown }; spec?: { unschedulable?: unknown; taints?: unknown } }): string {
  for (const key of ['labels', 'annotations']) {
    const value = body.metadata?.[key as 'labels' | 'annotations']
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string'))) return `metadata.${key} 必须是字符串键值对象`
  }
  if (body.spec?.unschedulable !== undefined && typeof body.spec.unschedulable !== 'boolean') return 'spec.unschedulable 必须是布尔值'
  const taints = body.spec?.taints
  if (taints !== undefined && (!Array.isArray(taints) || taints.some(item => !item || typeof item.key !== 'string' || !item.key || (item.value !== undefined && typeof item.value !== 'string') || !['NoSchedule', 'PreferNoSchedule', 'NoExecute'].includes(item.effect)))) return 'spec.taints 需要有效的 key、字符串 value 和 taint effect'
  return ''
}

/** 将节点 YAML 中可编辑的元数据/调度字段同步回概要，避免两个页面使用不同状态。 */
export function syncNodeDetailManifest(detail: NodeDetail, manifest: string): void {
  const body = parseDocument(manifest).toJS({ maxAliasCount: 100 })
  const entries = (value: unknown): string[] => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).map(([key, item]) => `${key}=${String(item ?? '')}`) : []
  detail.manifest = manifest
  detail.labels = entries(body.metadata?.labels)
  detail.annotations = entries(body.metadata?.annotations)
  detail.unschedulable = body.spec?.unschedulable === true
  detail.taints = Array.isArray(body.spec?.taints) ? body.spec.taints.map((item: { key: string; value?: string; effect: string }) => ({ key: item.key, value: item.value ?? '', effect: item.effect })) : []
}
