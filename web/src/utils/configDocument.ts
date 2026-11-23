import type { ConfigMapEntry, SecretEntry } from '@/types'
import type { ComparisonDocument } from '@/types/configComparison'
import { entryOptions } from './configEntries'

function entryDocument(entry: ConfigMapEntry | SecretEntry): Record<string, unknown> {
  const { mergeStrategy: _strategy, ...metadata } = entryOptions(entry)
  // Secret 仅比较键和挂载元数据，即使旧快照带有额外字段也不输出明文。
  const data = 'keys' in entry ? Object.fromEntries([...entry.keys].sort().map(key => [key, '••••••'])) : entry.data
  return { name: entry.name, ...metadata, data }
}

export function configDocument(values: Record<string, unknown>, maps: ConfigMapEntry[], secrets: SecretEntry[]): ComparisonDocument {
  return JSON.parse(JSON.stringify({ values, configmaps: Object.fromEntries(maps.map(item => [item.name, entryDocument(item)])), secrets: Object.fromEntries(secrets.map(item => [item.name, entryDocument(item)])) })) as ComparisonDocument
}
