import { parseDocument } from 'yaml'

export interface PodContainer { name: string; type: 'containers' | 'initContainers' | 'ephemeralContainers' }
export type PodLogRange = { type: 'lines' | 'duration' | 'since' | 'all'; value: number }
export interface PodLogOptions { container?: string; sinceSeconds?: number; sinceTime?: string; tailLines?: number; previous?: boolean }

/** Read only the three Pod spec lists; env, volumes and status names are not containers. */
export function podContainers(manifest: string): PodContainer[] {
  try {
    const document = parseDocument(manifest)
    if (document.errors.length) return []
    const data = document.toJS({ maxAliasCount: 100 })
    const result: PodContainer[] = [], seen = new Set<string>()
    for (const type of ['containers', 'initContainers', 'ephemeralContainers'] as const) {
      const items = data?.spec?.[type]
      if (!Array.isArray(items)) continue
      for (const item of items) if (typeof item?.name === 'string' && item.name && !seen.has(item.name)) {
        seen.add(item.name); result.push({ name: item.name, type })
      }
    }
    return result
  } catch { return [] }
}

export function logRangeError(range: PodLogRange, now = Date.now()): string {
  if (range.type === 'all') return ''
  if (!Number.isSafeInteger(range.value) || range.value <= 0) return '请输入大于 0 的整数'
  if (range.type === 'since' && range.value > now) return '开始时间不能晚于当前时间'
  return ''
}
export function logRangeOptions(range: PodLogRange): PodLogOptions {
  if (range.type === 'lines') return { tailLines: range.value }
  if (range.type === 'duration') return { sinceSeconds: range.value }
  if (range.type === 'since') return { sinceTime: new Date(range.value).toISOString() }
  return {}
}
export function logRangeLabel(range: PodLogRange): string {
  if (range.type === 'all') return '全部可用日志'
  if (range.type === 'lines') return `${range.value.toLocaleString()} 行`
  if (range.type === 'duration') return range.value % 3600 === 0 ? `最近 ${range.value / 3600} 小时` : `最近 ${range.value / 60} 分钟`
  return `${new Date(range.value).toLocaleString()} 起`
}

/** Local Mock filtering only; no command is executed. Grep patterns are literal strings. */
export function filterPodLogLines(lines: string[], query: string): { lines: string[]; error: string } {
  if (!query.trim()) return { lines, error: '' }
  if (!/^grep(?:\s|$)/.test(query.trim())) return { lines: lines.filter(line => line.includes(query)), error: '' }
  // Tokenize quoted literals and pipelines without interpreting shell substitution or escapes as code.
  const stages: string[][] = [[]]
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\|)|([^\s|"']+)/gy
  let at = 0
  while (at < query.length) {
    if (/\s/.test(query[at]!)) { at++; continue }
    pattern.lastIndex = at
    const match = pattern.exec(query)
    if (!match) return { lines: [], error: '引号未闭合，请检查搜索表达式' }
    at = pattern.lastIndex
    if (match[3]) stages.push([])
    else stages.at(-1)!.push(match[1] ?? match[2] ?? match[4]!)
  }
  let result = lines
  for (const stage of stages) {
    if (stage.shift() !== 'grep') return { lines: [], error: '管道仅支持 grep 文本过滤' }
    let before = 0, after = 0, insensitive = false
    while (stage[0]?.startsWith('-')) {
      const flag = stage.shift()
      if (flag === '--') break
      if (flag === '-i') { insensitive = true; continue }
      if (!['-A', '-B', '-C'].includes(flag!)) return { lines: [], error: '支持 grep -i、-A、-B、-C；搜索模式按普通文本匹配' }
      const size = stage.shift() ?? ''
      if (!/^\d+$/.test(size) || !Number.isSafeInteger(+size) || +size > 10000) return { lines: [], error: '上下文行数需为 0 到 10000 的整数' }
      if (flag === '-B' || flag === '-C') before = +size
      if (flag === '-A' || flag === '-C') after = +size
    }
    if (!stage.length) return { lines: [], error: '请输入 grep 搜索文本' }
    const needle = stage.join(' '), included = new Set<number>()
    result.forEach((line, index) => {
      if (!(insensitive ? line.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) : line.includes(needle))) return
      for (let i = Math.max(0, index - before); i <= Math.min(result.length - 1, index + after); i++) included.add(i)
    })
    result = result.filter((_, index) => included.has(index))
  }
  return { lines: result, error: '' }
}
