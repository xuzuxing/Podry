import { isMap, isNode, parseAllDocuments, type Document } from 'yaml'
import type { K8sResource } from '@/types'

export function resourceYamlDocuments(text: string) {
  if (!text.trim()) throw new Error('Manifest 不能为空')
  const documents = parseAllDocuments(text)
  const error = documents.flatMap(document => document.errors)[0]
  if (error) throw new Error(`YAML 格式错误：${error.message}`)
  const populated = documents.filter(document => document.contents !== null)
  if (!populated.length) throw new Error('Manifest 至少需要一个资源文档')
  return populated
}

function objectOf(document: Document): Record<string, unknown> {
  const value: unknown = document.toJS({ maxAliasCount: 100 })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest 必须是资源对象')
  return value as Record<string, unknown>
}

export function resourceIdentity(document: Document) {
  const value = objectOf(document)
  const metadata = value.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('请填写 metadata.name')
  const meta = metadata as Record<string, unknown>
  for (const [field, entry] of [['apiVersion', value.apiVersion], ['kind', value.kind], ['metadata.name', meta.name]] as const) {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error(`请填写有效的 ${field}`)
  }
  if (meta.namespace !== undefined && (typeof meta.namespace !== 'string' || !meta.namespace.trim())) throw new Error('metadata.namespace 必须为有效字符串')
  return { apiVersion: String(value.apiVersion), kind: String(value.kind), name: String(meta.name), namespace: typeof meta.namespace === 'string' ? meta.namespace : '' }
}

export function validateResourceEdit(text: string, resource: K8sResource): string {
  try {
    const documents = resourceYamlDocuments(text)
    if (documents.length !== 1) return '编辑现有资源时只能提交一个文档'
    const identity = resourceIdentity(documents[0]!)
    const { ref } = resource
    if (identity.name !== ref.name || identity.kind !== resource.kind || identity.apiVersion !== (ref.group ? `${ref.group}/${ref.version}` : ref.version)) return '编辑现有资源不能修改 apiVersion、kind 或 metadata.name'
    if (ref.namespace === '_cluster' ? Boolean(identity.namespace) : (identity.namespace || 'default') !== ref.namespace) return '编辑现有资源不能修改 metadata.namespace'
    return ''
  } catch (error) { return error instanceof Error ? error.message : 'Manifest 无法解析' }
}

/** 上游只隐藏 metadata.managedFields；其余元数据与同名业务字段继续保留。 */
export function resourceManifestView(text: string, hideManaged: boolean) {
  try {
    const documents = resourceYamlDocuments(text)
    const hasManagedFields = documents.some(document => isMap(document.get('metadata')) && document.hasIn(['metadata', 'managedFields']))
    if (!hideManaged || !hasManagedFields) return { text, hasManagedFields, error: '' }
    documents.forEach(document => document.deleteIn(['metadata', 'managedFields']))
    return { text: documents.map(document => document.toString()).join(''), hasManagedFields, error: '' }
  } catch (error) { return { text, hasManagedFields: false, error: error instanceof Error ? error.message : 'Manifest 无法解析' } }
}

/** 模拟 Kubernetes 保留服务端托管字段，不把隐藏后的提交误作字段删除。 */
export function retainManagedFields(before: string, submitted: string): string {
  const previous = resourceYamlDocuments(before)[0]!
  const next = resourceYamlDocuments(submitted)[0]!
  const managed = previous.getIn(['metadata', 'managedFields'], true)
  if (!isNode(managed) || next.hasIn(['metadata', 'managedFields'])) return submitted
  next.setIn(['metadata', 'managedFields'], managed.clone())
  return next.toString()
}

export interface ManifestDiffLine { text: string; number: number; changed: boolean }
export interface ManifestDiffHunk { leftStart: number; rightStart: number; leftCount: number; rightCount: number }
/** 行级 Diff：LCS 求最长公共子序列，展示 before/after 变化。 */
export function resourceManifestDiff(before: string, after: string) {
  const left = before.split('\n').map((text, index) => ({ text, number: index + 1, changed: false }))
  const right = after.split('\n').map((text, index) => ({ text, number: index + 1, changed: false }))
  const n = left.length, m = right.length
  const hunks: ManifestDiffHunk[] = []
  let hunk: ManifestDiffHunk | undefined
  function changed(side: 'left' | 'right', i: number, j: number) {
    hunk ??= { leftStart: Math.min(i + 1, n), rightStart: Math.min(j + 1, m), leftCount: 0, rightCount: 0 }
    if (side === 'left') { left[i]!.changed = true; hunk.leftCount++ }
    else { right[j]!.changed = true; hunk.rightCount++ }
  }
  function flush() { if (hunk) { hunks.push(hunk); hunk = undefined } }
  // 长清单使用有界位置比较，避免二次方矩阵耗尽内存。
  if (n * m > 500_000) {
    for (let index = 0; index < Math.max(n, m); index++) {
      if (left[index]?.text === right[index]?.text) { flush(); continue }
      if (index < n) changed('left', index, index)
      if (index < m) changed('right', index, index)
    }
  } else {
    const matrix = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) matrix[i]![j] = left[i]!.text === right[j]!.text ? matrix[i + 1]![j + 1]! + 1 : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!)
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && left[i]!.text === right[j]!.text) { flush(); i++; j++ }
      else if (j < m && (i === n || matrix[i]![j + 1]! >= matrix[i + 1]![j]!)) { changed('right', i, j); j++ }
      else { changed('left', i, j); i++ }
    }
  }
  flush()
  return { left, right, added: right.filter(line => line.changed).length, removed: left.filter(line => line.changed).length, hunks }
}
