import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ResourceTabKey = 'manifest' | 'events' | 'logs' | 'terminal'

export interface ResourceTab {
  /** 作用域 + GVR + Namespace + 名称（名称相同但 UID 不同视为新对象） */
  id: string
  /** 页签作用域：集群工作区用 clusterId，应用运行详情用 app:<appId>:<clusterId> */
  scope: string
  clusterId: string
  group: string
  resource: string
  namespace: string
  name: string
  kind: string
  tab: ResourceTabKey
}

interface TabSeed {
  scope?: string
  clusterId: string
  group: string
  resource: string
  namespace: string
  name: string
  kind: string
  tab?: ResourceTabKey
}

const scopeOf = (seed: TabSeed): string => seed.scope ?? seed.clusterId

const idOf = (seed: TabSeed): string =>
  `${scopeOf(seed)}|${seed.clusterId}|${seed.group}|${seed.resource}|${seed.namespace}|${seed.name}`

export const useResourceTabsStore = defineStore(
  'resourceTabs',
  () => {
    const tabs = ref<ResourceTab[]>([])

    const tabsOf = (scope: string): ResourceTab[] =>
      tabs.value.filter((item) => (item.scope ?? item.clusterId) === scope)

    function open(seed: TabSeed): string {
      const id = idOf(seed)
      const existing = tabs.value.find((item) => item.id === id)
      if (existing) {
        if (seed.tab) existing.tab = seed.tab
        return id
      }
      tabs.value.push({ ...seed, scope: scopeOf(seed), id, tab: seed.tab ?? 'manifest' })
      return id
    }

    function close(scope: string, id: string): void {
      void scope
      tabs.value = tabs.value.filter((item) => item.id !== id)
    }

    function closeOthers(scope: string, keepId: string): void {
      tabs.value = tabs.value.filter((item) => (item.scope ?? item.clusterId) !== scope || item.id === keepId)
    }

    function clearCluster(clusterId: string): void {
      tabs.value = tabs.value.filter((item) => item.clusterId !== clusterId)
    }

    function setTab(id: string, tab: ResourceTabKey): void {
      const target = tabs.value.find((item) => item.id === id)
      if (target) target.tab = tab
    }

    return { tabs, tabsOf, open, close, closeOthers, clearCluster, setTab }
  },
  { persist: { key: 'podry:resource-tabs', pick: ['tabs'] } },
)

export { idOf as resourceTabId }
