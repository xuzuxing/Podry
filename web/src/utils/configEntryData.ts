import { isAlias, isMap, isScalar, Pair, parseDocument } from 'yaml'
import type { YAMLMap } from 'yaml'

export interface ConfigDataRow { key: string; value: string; error: string }
export type ConfigDataChange = { type: 'key' | 'value'; index: number; value: string } | { type: 'remove'; index: number } | { type: 'add' }

// Keep pairs in the YAML tree: converting to an object would discard duplicate keys
// before the user can correct them, and would reorder integer-like keys.
export function readConfigData(source: string): { rows: ConfigDataRow[]; error: string } {
  const doc = parseDocument(source, { uniqueKeys: false })
  if (doc.errors.length) return { rows: [], error: doc.errors[0]!.message }
  if (!isMap(doc.contents)) return { rows: [], error: '数据必须为 YAML 键值对象' }
  try {
    const rows = doc.contents.items.map(pair => {
      const key = isScalar(pair.key) && ['string', 'number'].includes(typeof pair.key.value) ? String(pair.key.value) : null
      const value = isAlias(pair.value) ? pair.value.resolve(doc) : pair.value
      if (key === null || !isScalar(value) || typeof value.value !== 'string') throw new Error('GUI 仅支持字符串键值；请在 YAML 中修正，数字和布尔值需加引号')
      return { key, value: value.value, error: '' }
    })
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.key, (counts.get(row.key) ?? 0) + 1)
    for (const row of rows) row.error = !row.key ? '键名不能为空' : !/^[a-zA-Z0-9._-]+$/.test(row.key) ? '仅允许字母、数字、点、下划线和连字符' : counts.get(row.key)! > 1 ? '键名不能重复' : ''
    return { rows, error: '' }
  } catch (err) { return { rows: [], error: err instanceof Error ? err.message : '无法读取键值数据' } }
}

export function changeConfigData(source: string, change: ConfigDataChange): string {
  const parsed = readConfigData(source)
  if (parsed.error) return source
  const doc = parseDocument(source, { uniqueKeys: false })
  if (!isMap(doc.contents)) return source
  const map: YAMLMap = doc.contents
  if (change.type === 'add') {
    // A blank row is part of the draft, so save/leave validation sees it too.
    map.flow = false
    map.items.unshift(new Pair(doc.createNode(''), doc.createNode('')))
  } else {
    const pair = map.items[change.index]
    if (!pair) return source
    if (change.type === 'remove') map.items.splice(change.index, 1)
    else {
      const node = pair[change.type]
      if (isScalar(node)) node.value = change.value
      else pair[change.type] = doc.createNode(change.value)
    }
  }
  return String(doc)
}

export function maskedConfigData(source: string): string {
  const doc = parseDocument(source, { uniqueKeys: false })
  if (doc.errors.length || !isMap(doc.contents)) return '# Secret 草稿已隐藏；显示/编辑值后可修正 YAML。\n'
  // Recreate the document so comments and anchors cannot expose draft plaintext.
  const masked = parseDocument('{}')
  if (!isMap(masked.contents)) return ''
  const map: YAMLMap = masked.contents
  map.flow = false
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) return '# Secret 草稿已隐藏；显示/编辑值后可修正 YAML。\n'
    map.items.push(new Pair(masked.createNode(String(pair.key.value ?? '')), masked.createNode('••••••')))
  }
  return String(masked)
}
