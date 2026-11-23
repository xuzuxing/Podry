import { computed, watch, type Ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import type { TableSort } from 'tdesign-vue-next'
import { lastResourcePage, readResourceListState } from '@/utils/resourceListState'

export function useResourceListState(keys: Ref<string[]>, defaultSort: Ref<string>, total: Ref<number>, ready: Ref<boolean>) {
  const route = useRoute(), router = useRouter()
  const state = computed(() => readResourceListState(route.query, keys.value, defaultSort.value))
  function replace(query: LocationQuery): void { void router.replace({ query }) }
  function filter(key: string, value: string): void {
    const query = { ...route.query }
    if (value) query[key] = value
    else delete query[key]
    delete query.pageNumber
    delete query.page
    replace(query)
  }
  function changePage(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1) return
    replace({ ...route.query, pageNumber: String(Math.min(page, lastResourcePage(total.value, state.value.pageSize))) })
  }
  function changeSize(size: number): void {
    const normalized = readResourceListState({ pageSize: String(size) }, keys.value, defaultSort.value)
    const query: LocationQuery = { ...route.query, pageSize: String(normalized.pageSize) }
    delete query.pageNumber
    delete query.page
    replace(query)
  }
  function changeSort(value: TableSort): void {
    const order = Array.isArray(value) ? value[0] : value
    const query = { ...route.query }
    // TDesign emits undefined on its third step; Devtron keeps this column and returns to ASC.
    query.sortBy = order && keys.value.includes(order.sortBy) ? order.sortBy : state.value.sortBy
    query.sortOrder = order?.descending ? 'DESC' : 'ASC'
    delete query.pageNumber
    delete query.page
    replace(query)
  }
  // Only normalize after the matching request settles; never clamp against stale or cleared rows.
  watch([ready, state, total], () => {
    if (!ready.value) return
    const query = { ...route.query }, current = state.value
    const page = Math.min(current.pageNumber, lastResourcePage(total.value, current.pageSize))
    if (query.pageNumber !== undefined) query.pageNumber = String(page)
    if (query.pageSize !== undefined) query.pageSize = String(current.pageSize)
    if (query.sortBy !== undefined) query.sortBy = current.sortBy
    if (query.sortOrder !== undefined) query.sortOrder = current.sortOrder
    if (JSON.stringify(query) !== JSON.stringify(route.query)) replace(query)
  }, { flush: 'post' })
  return { state, filter, changePage, changeSize, changeSort }
}
