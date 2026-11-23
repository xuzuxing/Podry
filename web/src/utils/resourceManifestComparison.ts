import { isMap, stringify } from 'yaml'
import type { K8sResource } from '@/types'
import type { DesiredResourceManifest } from '@/types/resourceManifest'
import { resourceYamlDocuments, resourceManifestDiff, validateResourceEdit } from './resourceManifest'

function sortedValue(value: unknown, ancestors = new Set<object>(), depth = 0, budget = { remaining: 50_000 }): unknown {
  if (--budget.remaining < 0 || depth > 100) throw new Error('清单结构过于复杂，无法进行本地比较')
  if (!value || typeof value !== 'object') return value
  if (ancestors.has(value)) throw new Error('清单包含循环 YAML 引用，无法进行本地比较')
  ancestors.add(value)
  const result = Array.isArray(value)
    ? value.map(item => sortedValue(item, ancestors, depth + 1, budget))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedValue((value as Record<string, unknown>)[key], ancestors, depth + 1, budget)]))
  ancestors.delete(value)
  return result
}

/** Compare configuration, ignoring explicit server fields. This is not Kubernetes predicted live normalization. */
export function normalizeComparisonManifest(text: string): string {
  const documents = resourceYamlDocuments(text)
  if (documents.length !== 1) throw new Error('比较仅支持一个资源文档')
  const document = documents[0]!
  document.delete('status')
  const metadata = document.get('metadata', true)
  if (isMap(metadata)) {
    for (const field of ['managedFields', 'uid', 'resourceVersion', 'generation', 'creationTimestamp', 'selfLink']) metadata.delete(field)
    const annotations = metadata.get('annotations', true)
    if (isMap(annotations)) {
      annotations.delete('kubectl.kubernetes.io/last-applied-configuration')
      if (!annotations.items.length) metadata.delete('annotations')
    }
  }
  return stringify(sortedValue(document.toJS({ maxAliasCount: 100 })), { lineWidth: 0, aliasDuplicateObjects: false })
}

export function resourceComparisonView(resource: K8sResource, snapshot: DesiredResourceManifest) {
  if (snapshot.resourceUid !== resource.ref.uid) throw new Error('期望清单不属于当前资源，请刷新后重试')
  const desiredError = validateResourceEdit(snapshot.manifest, resource)
  if (desiredError) throw new Error(`期望 Manifest 无法比较：${desiredError}`)
  const liveError = validateResourceEdit(resource.manifest, resource)
  if (liveError) throw new Error(`实时 Manifest 无法比较：${liveError}`)
  const desired = normalizeComparisonManifest(snapshot.manifest), live = normalizeComparisonManifest(resource.manifest)
  return { desired, live, drift: desired !== live, diff: resourceManifestDiff(desired, live) }
}
