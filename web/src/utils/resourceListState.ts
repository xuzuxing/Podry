import { queryText } from './resourceFilters'

export const RESOURCE_PAGE_SIZES = [100, 150, 200]
export const NODE_PAGE_SIZES = [20, 40, 50]
const validSizes = [...NODE_PAGE_SIZES, ...RESOURCE_PAGE_SIZES]
export interface ResourceListState { pageNumber: number; pageSize: number; sortBy: string; sortOrder: 'ASC' | 'DESC' }

export function readResourceListState(query: Record<string, unknown>, keys: string[], defaultSort: string): ResourceListState {
  const page = queryText(query.pageNumber), size = Number(queryText(query.pageSize))
  const pageNumber = /^\d+$/.test(page) && Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1
  const sortBy = queryText(query.sortBy)
  return { pageNumber, pageSize: validSizes.includes(size) ? size : 100, sortBy: keys.includes(sortBy) ? sortBy : defaultSort, sortOrder: queryText(query.sortOrder) === 'DESC' ? 'DESC' : 'ASC' }
}

export function lastResourcePage(total: number, pageSize: number): number { return Math.max(1, Math.ceil(total / pageSize)) }

/** Filter all rows, sort all matches, then slice; stable native sort retains equal-key ordering. */
export function resourcePage<T>(rows: T[], state: ResourceListState, compare: (a: T, b: T) => number): T[] {
  const page = Math.min(state.pageNumber, lastResourcePage(rows.length, state.pageSize))
  const start = (page - 1) * state.pageSize
  return [...rows].sort(compare).slice(start, start + state.pageSize)
}
