import type { ComparisonDocument, ComparisonSide } from '@/types/configComparison'
import type { ConfigVariableSnapshot, VariableConfiguration } from '@/types/configVariables'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const token = /@\{\{([a-zA-Z][a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])\}\}/g
const sourceOf = (document: ComparisonDocument): VariableConfiguration => clone({ values: document.values, configmaps: document.configmaps })

export function hasScopedVariables(document: ComparisonDocument | null): boolean {
  return !!document && JSON.stringify(sourceOf(document)).includes('@{{')
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const lhs = Object.entries(left), rhs = Object.entries(right)
  return lhs.length === rhs.length && lhs.every(([key, value]) => Object.hasOwn(right, key) && sameValue(value, (right as Record<string, unknown>)[key]))
}

/** 仅供 Mock adapter：字面字符串替换，不执行模板、表达式、递归变量或网络请求。 */
export function captureConfigVariables(document: ComparisonDocument, variables: Readonly<Record<string, string>>): ConfigVariableSnapshot | undefined {
  if (!hasScopedVariables(document)) return undefined
  const source = sourceOf(document), names = new Set<string>(), missing = new Set<string>()
  function resolve(value: unknown): unknown {
    if (typeof value === 'string') {
      const result = value.replace(token, (match, name: string) => {
        names.add(name)
        if (!Object.hasOwn(variables, name)) { missing.add(name); return match }
        return variables[name]!
      })
      if (result.includes('@{{')) missing.add('未解析引用')
      return result
    }
    if (Array.isArray(value)) return value.map(resolve)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]))
    return value
  }
  const resolved: VariableConfiguration = {
    values: resolve(source.values) as Record<string, unknown>,
    configmaps: Object.fromEntries(Object.entries(source.configmaps).map(([name, entry]) => [name, { ...entry, data: resolve(entry.data) }])),
  }
  // 名称/挂载等元数据不属于本地解析契约；不能悄悄留下未解析引用。
  if (JSON.stringify(resolved).includes('@{{')) missing.add('未解析引用')
  return { source, resolved: missing.size ? null : clone(resolved), variableNames: [...names].sort(), error: missing.size ? `无法解析作用域变量：${[...missing].join('、')}。` : '' }
}

export function resolveVariableSide(side: ComparisonSide, enabled: boolean): ComparisonSide {
  if (!enabled || !side.document || !hasScopedVariables(side.document)) return side
  const snapshot = side.variableSnapshot
  if (!snapshot) return { ...side, document: null, notice: '', error: '该版本未保存变量解析快照，无法显示变量值。' }
  if (!sameValue(snapshot.source, sourceOf(side.document))) return { ...side, document: null, notice: '', error: '变量解析快照与原始配置不匹配，请刷新或选择其他版本。' }
  if (!snapshot.resolved || snapshot.error) return { ...side, document: null, notice: '', error: snapshot.error || '该版本的变量解析结果不可用。' }
  // 只取解析契约中的字段；额外 Secret 字段不允许覆盖遮蔽文档。
  return { ...side, document: { values: clone(snapshot.resolved.values), configmaps: clone(snapshot.resolved.configmaps), secrets: clone(side.document.secrets) } }
}
