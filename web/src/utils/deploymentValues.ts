import { isAlias, parseDocument, stringify } from 'yaml'
import type { Binding, DeployValues } from '@/types'

export type MergeStrategy = 'patch' | 'replace'
export type ValuesResult = { values: DeployValues; error?: never } | { values?: never; error: string }

export function isValuesMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Values 编辑使用完整 YAML；这不是 Helm schema 或 Kubernetes server-side 验证。 */
export function parseValues(source: string): ValuesResult {
  try {
    const document = parseDocument(source, { uniqueKeys: true })
    if (document.errors.length) return { error: document.errors[0]!.message }
    if (document.warnings.length) return { error: document.warnings[0]!.message }
    const values: unknown = document.contents === null ? {} : document.toJS({ maxAliasCount: 100 })
    if (!isValuesMap(values)) return { error: 'Values 顶层必须是键值对象，不能是列表或标量' }
    const seen = new Set<object>()
    const validate = (node: unknown): void => {
      if (typeof node === 'number' && !Number.isFinite(node)) throw new Error('Values 不支持非有限数字')
      if (!node || typeof node !== 'object') return
      if (seen.has(node)) throw new Error('Values 不支持循环引用')
      seen.add(node)
      Object.entries(node).forEach(([key, value]) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`不支持的字段名：${key}`)
        validate(value)
      })
      seen.delete(node)
    }
    validate(values)
    const integer = (key: string, value: unknown, min: number, max: number): void => {
      if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)) {
        throw new Error(`${key} 需为 ${min}–${max} 之间的整数`)
      }
    }
    integer('replicaCount', values.replicaCount, 0, 1000)
    integer('containerPort', values.containerPort, 1, 65535)
    if (values.host !== undefined && typeof values.host !== 'string') throw new Error('host 必须是字符串')
    if (values.env !== undefined && (!isValuesMap(values.env) || Object.values(values.env).some((value) => typeof value !== 'string'))) {
      throw new Error('env 必须是字符串键值对象；数字和布尔值请加引号')
    }
    if (values.job !== undefined) {
      if (!isValuesMap(values.job)) throw new Error('job 必须是键值对象')
      integer('job.backoffLimit', values.job.backoffLimit, 0, 1000)
      integer('job.activeDeadlineSeconds', values.job.activeDeadlineSeconds, 1, 604800)
    }
    return { values: JSON.parse(JSON.stringify(values)) as DeployValues }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'YAML 解析失败' }
  }
}

export function valuesYaml(values: DeployValues): string {
  return stringify(values, { lineWidth: 0 })
}

/** GUI 只更新对应节点，保留其他 YAML 字段与注释。 */
export function updateValuesField(source: string, path: string[], value: unknown, remove = false): string {
  const document = parseDocument(source)
  // GUI 编辑别名引用下的字段时，将该处展开，避免修改共用锚点或抛出集合路径错误。
  for (let depth = 1; depth < path.length; depth++) {
    const prefix = path.slice(0, depth)
    if (!isAlias(document.getIn(prefix, true))) continue
    let expanded: unknown = document.toJS({ maxAliasCount: 100 })
    for (const key of prefix) expanded = (expanded as Record<string, unknown>)[key]
    document.setIn(prefix, document.createNode(expanded))
  }
  if (remove) document.deleteIn(path)
  else document.setIn(path, value)
  return document.toString({ lineWidth: 0 })
}

/** 本地 Patch 预览递归合并对象，数组整体替换；不模拟服务端的字段保护规则。 */
export function mergeValues(base: DeployValues, override: DeployValues, strategy: MergeStrategy = 'patch'): DeployValues {
  if (strategy === 'replace') return JSON.parse(JSON.stringify(override)) as DeployValues
  const result: DeployValues = JSON.parse(JSON.stringify(base)) as DeployValues
  Object.entries(override).forEach(([key, value]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return
    result[key] = isValuesMap(value) && isValuesMap(result[key])
      ? mergeValues(result[key] as DeployValues, value)
      : JSON.parse(JSON.stringify(value)) as unknown
  })
  return result
}

export function hasOverride(binding?: Binding | null): boolean {
  return binding?.overrideEnabled ?? Boolean(binding && Object.keys(binding.overrideValues).length)
}

export function effectiveValues(base: DeployValues, binding?: Binding | null): DeployValues {
  return hasOverride(binding) ? mergeValues(base, binding!.overrideValues, binding?.overrideMergeStrategy) : mergeValues(base, {})
}

export function flattenValues(input: unknown, prefix = ''): Record<string, string> {
  if (isValuesMap(input) || Array.isArray(input)) {
    const entries = Object.entries(input)
    if (!entries.length) return prefix ? { [prefix]: Array.isArray(input) ? '[]' : '{}' } : {}
    return Object.assign({}, ...entries.map(([key, value]) => flattenValues(value, prefix ? `${prefix}.${key}` : key))) as Record<string, string>
  }
  return { [prefix]: input === null ? 'null' : String(input) }
}
