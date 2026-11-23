import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NODE_FILTER_KEYS, queryText, readNodeFilters, type NodeFilterKey } from '@/utils/resourceFilters'

/** URL is the applied state; drafts belong to the picker, never to this composable. */
export function useNodeListFilters() {
  const route = useRoute(), router = useRouter()
  const filters = computed(() => readNodeFilters(route.query))
  const search = computed(() => queryText(route.query.searchKey))
  function update(key: NodeFilterKey | 'searchKey', values: string[] | string): void {
    const value = Array.isArray(values) ? [...new Set(values.map(item => item.trim()).filter(Boolean))].join(',') : values
    const query = { ...route.query }
    if (value) query[key] = value
    else delete query[key]
    delete query.page
    delete query.pageNumber
    void router.replace({ query })
  }
  function clear(): void {
    const query = { ...route.query }
    NODE_FILTER_KEYS.forEach(key => { delete query[key] })
    delete query.page
    delete query.pageNumber
    void router.replace({ query })
  }
  return { filters, search, update, clear }
}
