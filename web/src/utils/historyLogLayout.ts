import type { HistoryLogStage, LogLine } from './historyLogs'

export interface HistoryLogRow {
  key: string
  stage: HistoryLogStage
  line?: LogLine
  top: number
  height: number
}
export function historyLogRows(stages: HistoryLogStage[], closed: ReadonlySet<string>, heights: ReadonlyMap<string, number>, wrap: boolean, width: number): HistoryLogRow[] {
  const rows: HistoryLogRow[] = []
  const columns = Math.max(12, Math.floor((width - 80) / 7.83))
  let top = 0
  for (const stage of stages) {
    const headerKey = `stage:${stage.key}`, height = heights.get(headerKey) ?? 36
    rows.push({ key: headerKey, stage, top, height }); top += height
    if (closed.has(stage.key)) continue
    for (const line of stage.lines) {
      const key = `line:${stage.key}:${line.number}`
      const length = line.segments.reduce((sum, segment) => sum + [...segment.text].reduce((size, character) => size + (/[^\x00-\xff]/u.test(character) ? 2 : character === '\t' ? 4 : 1), 0), 0)
      const height = heights.get(key) ?? (wrap ? Math.max(1, Math.ceil(length / columns)) * 20 + 4 : 24)
      rows.push({ key, stage, line, top, height }); top += height
    }
  }
  return rows
}
/** Binary lookup keeps scroll events independent of the total number of log rows. */
export function historyLogRowAt(rows: HistoryLogRow[], position: number): number {
  let low = 0, high = rows.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (rows[middle]!.top + rows[middle]!.height <= position) low = middle + 1
    else high = middle
  }
  return low
}
