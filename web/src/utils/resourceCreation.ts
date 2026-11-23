import type { ApplyItemResult } from '@/api'

export interface CreatedResourceRow {
  index: number
  kind: string
  name: string
  status: 'created' | 'updated' | 'succeeded' | 'failed' | 'skipped'
  message: string
}

/** Mock Apply 的成功说明区分创建/更新；未知成功说明保留为“已应用”。 */
export function createdResourceRows(items: ApplyItemResult[]): CreatedResourceRow[] {
  return items.map((item, index) => {
    const separator = item.ref.indexOf('/')
    return {
      index, kind: separator < 0 ? item.ref || '—' : item.ref.slice(0, separator) || '—',
      name: separator < 0 ? '—' : item.ref.slice(separator + 1) || '—',
      status: item.result !== 'succeeded' ? item.result : item.message === '已创建' ? 'created' : item.message === '已更新' ? 'updated' : 'succeeded',
      message: item.result === 'succeeded' ? '' : item.message,
    }
  })
}
