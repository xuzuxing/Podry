import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResourceTabsStore, type ResourceTab, type ResourceTabKey } from '@/stores/resourceTabs'
import { detailQueryText, resourceContainer, resourceDetailQuery, resourceDetailTab, resourceTabAddress } from '@/utils/resourceDetailLocation'

interface ResourceDetailLocationOptions {
  scope: () => string
  clusterId: () => string
  ready: () => boolean
  kind: (resource: Omit<ResourceTab, 'kind' | 'tab'>) => string | undefined
}

/** Apply route state only after navigation guards accept it; cancelled navigation never changes the store. */
export function useResourceDetailLocation(options: ResourceDetailLocationOptions) {
  const route = useRoute(), router = useRouter(), store = useResourceTabsStore()
  const current = (): ResourceTab | undefined => store.tabsOf(options.scope()).find(item => item.id === detailQueryText(route.query.tab))
  watch([options.scope, options.clusterId, options.ready, () => route.query.tab, () => route.query.resourceTab, () => route.query.container], () => {
    if (!options.ready()) return
    let resource = current()
    if (!resource) {
      const address = resourceTabAddress(detailQueryText(route.query.tab), options.scope(), options.clusterId())
      const kind = address && options.kind(address)
      if (!address || !kind) return
      store.open({ ...address, kind })
      resource = current()
    }
    if (!resource) return
    if (route.query.resourceTab !== undefined) {
      store.setTab(resource.id, resourceDetailTab(detailQueryText(route.query.resourceTab), resource))
      store.setContainer(resource.id, !resource.group && resource.resource === 'pods' ? resourceContainer(detailQueryText(route.query.container)) : undefined)
    }
  }, { immediate: true })

  function select(tab: ResourceTabKey): void {
    const resource = current()
    if (!resource) return
    void router.push({ query: resourceDetailQuery(route.query, { ...resource, tab }) })
  }
  function container(value: string): void {
    const resource = current(), name = resourceContainer(value)
    if (!resource || !name || resource.container === name && detailQueryText(route.query.container) === name) return
    void router.replace({ query: resourceDetailQuery(route.query, { ...resource, container: name }) })
  }
  function queryFor(id: string) { return resourceDetailQuery(route.query, store.tabsOf(options.scope()).find(item => item.id === id)) }
  return { select, container, queryFor }
}
