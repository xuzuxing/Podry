import { parseDocument, stringify } from 'yaml'
import type { ConfigEntryOptions, ConfigMapEntry, SecretEntry } from '@/types'

export type ConfigEntry = ConfigMapEntry | SecretEntry
export type ConfigEntryKind = 'configmaps' | 'secrets'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export interface ConfigEntryItem {
  name: string
  base?: ConfigEntry
  own?: ConfigEntry
  effective: ConfigEntry
}
export function entryData(entry?: ConfigEntry): Record<string, string> {
  if (!entry) return {}
  return 'data' in entry ? entry.data : Object.fromEntries(entry.keys.map((key) => [key, '••••••']))
}
export function effectiveEntries<T extends ConfigEntry>(base: T[], overrides: T[]): T[] {
  const names = [...new Set([...base.map((item) => item.name), ...overrides.map((item) => item.name)])]
  return names.map((name) => {
    const inherited = base.find((item) => item.name === name)
    const own = overrides.find((item) => item.name === name)
    if (!own) return clone(inherited!)
    if (!inherited || own.mergeStrategy !== 'patch') return clone(own)
    const merged = { ...clone(inherited), id: own.id, environmentId: own.environmentId, updatedAt: own.updatedAt, mergeStrategy: 'patch' } as T
    if ('data' in merged && 'data' in own) {
      merged.data = { ...merged.data, ...own.data }
      merged.dataYaml = stringify(merged.data)
    } else if ('keys' in merged && 'keys' in own) merged.keys = [...new Set([...merged.keys, ...own.keys])]
    return merged
  })
}
export function configEntryItems(base: ConfigEntry[], own: ConfigEntry[], override: boolean): ConfigEntryItem[] {
  const effective = override ? effectiveEntries(base, own) : own
  return effective.map((entry) => ({
    name: entry.name, effective: entry,
    base: override ? base.find((item) => item.name === entry.name) : undefined,
    own: own.find((item) => item.name === entry.name),
  }))
}
export function entryOptions(entry?: ConfigEntryOptions): Required<ConfigEntryOptions> {
  return {
    source: entry?.source ?? 'create', mountAs: entry?.mountAs ?? 'env',
    mountPath: entry?.mountPath ?? '', subPath: entry?.subPath ?? false,
    fileMode: entry?.fileMode ?? '', mergeStrategy: entry?.mergeStrategy ?? 'replace',
  }
}
export function parseEntryData(source: string): { data: Record<string, string>; error: string } {
  try {
    const doc = parseDocument(source)
    if (doc.errors.length) throw new Error(doc.errors[0]!.message)
    const value: unknown = doc.toJS({ maxAliasCount: 100 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据必须是键值对象')
    for (const [key, val] of Object.entries(value)) {
      if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error(`无效的键名：${key}`)
      if (typeof val !== 'string') throw new Error(`${key} 的值必须为字符串，数字和布尔值请加引号`)
    }
    return { data: value as Record<string, string>, error: '' }
  } catch (err) { return { data: {}, error: err instanceof Error ? err.message : 'YAML 解析失败' } }
}
