import type { CSSProperties } from 'vue'

export type LogStyle = Pick<CSSProperties, 'color' | 'backgroundColor' | 'fontWeight' | 'fontStyle' | 'textDecoration'>
export interface LogSegment { text: string; match: number | null; style?: LogStyle }
export interface LogLine {
  number: number
  segments: LogSegment[]
}

export type HistoryStageStatus = 'succeeded' | 'failed' | 'running' | 'queued' | 'canceled' | 'unknown'
export interface HistoryLogStage {
  key: string
  title: string
  status: HistoryStageStatus
  startTime: string
  endTime: string
  platforms: string[]
  lines: LogLine[]
}
export interface HistoryLogResult {
  stages: HistoryLogStage[]
  lines: LogLine[]
  count: number
  matches: Array<{ stageKey: string; line: number }>
}
const palette = ['#1e2229', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d8dee9', '#697586', '#ff8b94', '#b5e890', '#ffdb8a', '#8cc8ff', '#e3a0ef', '#8ce0e6', '#ffffff']
function ansiColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 16) return palette[index]
  if (index >= 232) { const value = (8 + (index - 232) * 10).toString(16).padStart(2, '0'); return `#${value.repeat(3)}` }
  const cube = [0, 95, 135, 175, 215, 255], value = index - 16
  return `rgb(${cube[Math.floor(value / 36)]}, ${cube[Math.floor(value / 6) % 6]}, ${cube[value % 6]})`
}
function applySgr(style: LogStyle, code: string): LogStyle {
  const codes = (code || '0').split(';').map(Number)
  let next = { ...style }
  for (let index = 0; index < codes.length; index++) {
    const value = codes[index]!
    if (value === 0) next = {}
    else if (value === 1) next.fontWeight = '700'
    else if (value === 3) next.fontStyle = 'italic'
    else if (value === 4) next.textDecoration = 'underline'
    else if (value === 22) delete next.fontWeight
    else if (value === 23) delete next.fontStyle
    else if (value === 24) delete next.textDecoration
    else if (value === 39) delete next.color
    else if (value === 49) delete next.backgroundColor
    else if (value >= 30 && value <= 37) next.color = palette[value - 30]
    else if (value >= 90 && value <= 97) next.color = palette[value - 90 + 8]
    else if (value >= 40 && value <= 47) next.backgroundColor = palette[value - 40]
    else if (value >= 100 && value <= 107) next.backgroundColor = palette[value - 100 + 8]
    else if (value === 38 || value === 48) {
      const property = value === 38 ? 'color' : 'backgroundColor'
      if (codes[index + 1] === 5) { const color = ansiColor(codes[index + 2]!); if (color) next[property] = color; index += 2 }
      else if (codes[index + 1] === 2) {
        const rgb = codes.slice(index + 2, index + 5)
        if (rgb.length === 3 && rgb.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) next[property] = `rgb(${rgb.join(', ')})`
        index += 4
      }
    }
  }
  return next
}
/** Only SGR styles become Vue style objects. OSC, CSI commands and HTML never become markup or links. */
function ansiLines(text: string): LogLine[] {
  let style: LogStyle = {}
  return text.split(/\r?\n/).map((raw, index) => {
    const line = raw.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    const segments: LogSegment[] = []
    let offset = 0
    for (const escape of line.matchAll(/\x1b\[([0-9;?]*)([ -/]*[@-~])|\x1b[@-_]/g)) {
      if (escape.index! > offset) segments.push({ text: line.slice(offset, escape.index), match: null, style: { ...style } })
      if (escape[2] === 'm' && /^[0-9;]*$/.test(escape[1]!)) style = applySgr(style, escape[1]!)
      offset = escape.index! + escape[0].length
    }
    if (offset < line.length) segments.push({ text: line.slice(offset), match: null, style: { ...style } })
    for (const segment of segments) segment.text = segment.text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    if (!segments.length) segments.push({ text: '', match: null })
    return { number: index + 1, segments }
  })
}
function highlight(lines: LogLine[], query: string, start: number): { lines: LogLine[]; count: number } {
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') : null
  let count = start
  return { lines: lines.map(line => {
    if (!pattern) return line
    const text = line.segments.map(segment => segment.text).join('')
    pattern.lastIndex = 0
    const hits = [...text.matchAll(pattern)].map(hit => ({ start: hit.index!, end: hit.index! + hit[0].length, match: count++ }))
    const segments: LogSegment[] = []
    let offset = 0, hitIndex = 0
    for (const segment of line.segments) {
      const end = offset + segment.text.length
      let cursor = offset
      while (hitIndex < hits.length && hits[hitIndex]!.end <= cursor) hitIndex++
      while (cursor < end) {
        const hit = hits[hitIndex], matched = hit && cursor >= hit.start && cursor < hit.end
        const next = Math.min(end, hit ? matched ? hit.end : hit.start : end)
        segments.push({ text: text.slice(cursor, next), match: matched ? hit.match : null, style: segment.style })
        cursor = next
        if (hit && cursor >= hit.end) hitIndex++
      }
      offset = end
    }
    return { ...line, segments: segments.length ? segments : [{ text: '', match: null }] }
  }), count }
}
/** Literal, case-insensitive search. Log content is always rendered as text, never HTML.
 * A hit spanning ANSI styles has one match index. */
export function searchLogLines(text: string, query: string): { lines: LogLine[]; count: number } {
  return highlight(ansiLines(text), query, 0)
}
export function historyStageStatus(value: unknown): HistoryStageStatus {
  const key = typeof value === 'string' ? value.toLowerCase() : ''
  if (['success', 'succeeded'].includes(key)) return 'succeeded'
  if (['failure', 'failed'].includes(key)) return 'failed'
  if (['progressing', 'running', 'canceling'].includes(key)) return 'running'
  if (['queued', 'pending'].includes(key)) return 'queued'
  if (['canceled', 'cancelled'].includes(key)) return 'canceled'
  return 'unknown'
}
function validDate(value: unknown): string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '' }
export function historyStageDuration(stage: Pick<HistoryLogStage, 'startTime' | 'endTime'>): string {
  if (!stage.startTime || !stage.endTime) return ''
  const milliseconds = Date.parse(stage.endTime) - Date.parse(stage.startTime)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return ''
  if (milliseconds < 1000) return '< 1s'
  const seconds = Math.floor(milliseconds / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}
/** Devtron STAGE_INFO events update a stage by its name + startTime; malformed events remain readable. */
export function parseHistoryLogs(text: string, query: string, title: string, status = ''): HistoryLogResult {
  const groups: Array<{ stage: HistoryLogStage; raw: string[] }> = []
  const identities = new Map<string, number>()
  let active = -1
  const fallback = () => {
    if (active >= 0) return
    active = groups.length
    groups.push({ stage: { key: 'plain', title, status: historyStageStatus(status), startTime: '', endTime: '', platforms: [], lines: [] }, raw: [] })
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('STAGE_INFO|')) {
      try {
        const info: unknown = JSON.parse(line.slice('STAGE_INFO|'.length))
        if (info && typeof info === 'object' && 'stage' in info && typeof info.stage === 'string' && info.stage.trim()) {
          const item = info as Record<string, unknown>, startTime = validDate(item.startTime)
          const key = JSON.stringify([item.stage, typeof item.startTime === 'string' ? item.startTime : ''])
          let index = identities.get(key)
          if (index === undefined) {
            index = groups.length; identities.set(key, index)
            groups.push({ stage: { key, title: info.stage, startTime, endTime: '', status: 'unknown', platforms: [], lines: [] }, raw: [] })
          }
          const stage = groups[index]!.stage
          if ('status' in item) stage.status = historyStageStatus(item.status)
          if ('endTime' in item) stage.endTime = validDate(item.endTime)
          if (item.metadata && typeof item.metadata === 'object' && 'targetPlatforms' in item.metadata && Array.isArray(item.metadata.targetPlatforms)) {
            stage.platforms = [...new Set(item.metadata.targetPlatforms.filter((part): part is string => typeof part === 'string' && Boolean(part.trim())))]
          }
          active = index
          continue
        }
      } catch { /* Keep corrupt marker text in the log instead of silently discarding it. */ }
    }
    fallback(); groups[active]!.raw.push(line)
  }
  let count = 0
  const matches: HistoryLogResult['matches'] = []
  const stages = groups.map(({ stage, raw }) => {
    const result = highlight(raw.length ? ansiLines(raw.join('\n')) : [], query, count)
    for (const line of result.lines) for (const segment of line.segments) {
      if (segment.match !== null && !matches[segment.match]) matches[segment.match] = { stageKey: stage.key, line: line.number }
    }
    count = result.count
    return { ...stage, lines: result.lines }
  })
  return { stages, lines: stages.flatMap(stage => stage.lines), count, matches }
}
