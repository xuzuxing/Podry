import type { Application } from '@/types'

/** Application selection is a full list upstream. Collect Mock pages instead of silently stopping at page 1. */
export async function readApplicationCloneSources(
  fetchPage: (query: {page: number; pageSize: number}) => Promise<{items: Application[]; total: number}>,
  current: () => boolean = () => true,
): Promise<Application[]> {
  const rows = new Map<string, Application>()
  const pageSize = 100
  for (let page = 1; ; page++) {
    const result = await fetchPage({page, pageSize})
    if (!current()) return []
    let added = 0
    for (const item of result.items) {
      if (!rows.has(item.id)) added++
      rows.set(item.id, item)
    }
    if (!result.items.length || page * pageSize >= result.total) break
    if (!added) throw new Error('源应用列表分页异常，请重试')
  }
  return [...rows.values()].filter(item => !item.archivedAt)
}
