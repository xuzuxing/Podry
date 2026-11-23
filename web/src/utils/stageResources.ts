import type { ConfigMapEntry, SecretEntry, StageResourceReferences } from '@/types'
import { effectiveEntries } from './configEntries'

export interface StageResourceOption { kind: 'configMaps' | 'secrets'; name: string; inherited: boolean }
export function emptyStageResources(): StageResourceReferences { return { configMaps: [], secrets: [] } }
export function stageResourceOptions(baseMaps: ConfigMapEntry[], maps: ConfigMapEntry[], baseSecrets: SecretEntry[], secrets: SecretEntry[]): StageResourceOption[] {
  return [
    ...effectiveEntries(baseMaps, maps).map(item => ({ kind: 'configMaps' as const, name: item.name, inherited: !maps.some(own => own.name === item.name) })),
    ...effectiveEntries(baseSecrets, secrets).map(item => ({ kind: 'secrets' as const, name: item.name, inherited: !secrets.some(own => own.name === item.name) })),
  ].sort((a,b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
}
export function stageResourceErrors(refs: StageResourceReferences, options: StageResourceOption[]): string[] {
  return (['configMaps','secrets'] as const).flatMap(kind => {
    const label = kind === 'configMaps' ? 'ConfigMap' : 'Secret'
    const errors = refs[kind].filter(name => !options.some(item => item.kind === kind && item.name === name)).map(name => `${label} ${name} 已不可用，请移除引用`)
    if (new Set(refs[kind]).size !== refs[kind].length) errors.push(`${label} 引用不能重复`)
    return errors
  })
}
