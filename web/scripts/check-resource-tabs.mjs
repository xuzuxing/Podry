// Resource tab scope, visit history and draft-aware refresh; frontend only.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { shallowRef } from 'vue'
import { resolve } from 'node:path'
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
try {
  const { useResourceTabsStore } = await server.ssrLoadModule('/src/stores/resourceTabs.ts')
  setActivePinia(createPinia())
  const store = useResourceTabsStore()
  const seed = { clusterId: 'cluster-a', group: '', resource: 'pods', namespace: 'shop', name: 'api', kind: 'Pod' }
  const a = store.open(seed), b = store.open({ ...seed, name: 'worker' }), c = store.open({ ...seed, name: 'job' })
  check('Opening existing tab keeps one identity and updates detail tab', store.open({ ...seed, tab: 'logs' }) === a && store.tabsOf('cluster-a').length === 3 && store.tabsOf('cluster-a')[0].tab === 'logs')
  store.activate('cluster-a', '')
  store.activate('cluster-a', a); store.activate('cluster-a', c); store.activate('cluster-a', b)
  check('Closing selected returns last visited rather than last created', store.previous('cluster-a', b) === c)
  store.close('cluster-a', b); store.activate('cluster-a', c)
  check('Closed tabs never become a later fallback', store.previous('cluster-a', c) === a)
  store.activate('cluster-a', ''); store.activate('cluster-a', a)
  check('Fixed resource listing is a valid previous location', store.previous('cluster-a', a) === '')
  store.activate('cluster-a', 'unknown-id')
  check('Unknown tab does not replace last visit', store.previous('cluster-a', a) === '')
  const app = store.open({ ...seed, scope: 'app:checkout:cluster-a' })
  const group = store.open({ ...seed, group: 'other.example' })
  const ns = store.open({ ...seed, namespace: 'other' })
  check('Same resource remains isolated across manager, group and namespace', new Set([a, app, group, ns]).size === 4)
  store.close('cluster-a', app)
  check('Foreign scope cannot close an application tab', store.tabs.some(tab => tab.id === app))
  store.closeOthers('cluster-a', a)
  check('Close others keeps target and foreign manager tabs', store.tabsOf('cluster-a').length === 1 && store.tabs.some(tab => tab.id === app))
  store.activate('cluster-a', a)
  check('Stale history entries are skipped after close others', store.previous('cluster-a', a) === '')
  const foreign = store.open({ ...seed, clusterId: 'cluster-b' })
  store.clearCluster('cluster-a')
  check('Clear cluster preserves other cluster resource tabs', store.tabs.length === 1 && store.tabs[0].id === foreign)

  const { useResourceTabRefresh } = await server.ssrLoadModule('/src/composables/useResourceTabRefresh.ts')
  const currentId = shallowRef('tab-a')
  let reads = 0, allowed = false
  const panel = shallowRef({ requestLeave: () => allowed, reload: async () => { reads++ } })
  let current = panel.value
  const refresh = useResourceTabRefresh(() => panel.value, () => currentId.value)
  await refresh.refresh()
  check('Cancelled draft confirmation never reloads or stamps sync', reads === 0 && refresh.syncedAt.value === 0 && !refresh.refreshing.value)
  allowed = true
  current.reload = async () => { reads++; refresh.synced() }
  await refresh.refresh()
  const firstSync = refresh.syncedAt.value
  check('Successful read stamps current resource sync', reads === 1 && firstSync > 0 && !refresh.refreshing.value)
  const waiting = deferred()
  current.requestLeave = () => waiting.promise
  const pending = refresh.refresh()
  check('Pending confirmation marks active tab as refreshing', refresh.refreshing.value)
  await refresh.refresh()
  waiting.resolve(true); await pending
  check('Repeated refresh clicks cannot start duplicate reads', reads === 2)
  const switching = deferred()
  current.requestLeave = () => switching.promise
  const late = refresh.refresh()
  currentId.value = 'tab-b'; current = { requestLeave: () => true, reload: async () => { reads += 100 } }; panel.value = current
  switching.resolve(true); await late
  check('Navigation while confirming discards stale refresh', reads === 2 && !refresh.refreshing.value && refresh.syncedAt.value === 0)
  refresh.synced()
  check('New resource sync is independent from previous tab', refresh.syncedAt.value > 0)
  currentId.value = 'tab-a'
  check('Returning to a tab restores its successful sync time', refresh.syncedAt.value >= firstSync)
  current.requestLeave = () => true
  current.reload = async () => { throw new Error('read failed') }
  const beforeFailure = refresh.syncedAt.value
  await assert.rejects(refresh.refresh(), /read failed/)
  check('Failed read releases refresh state and preserves last success', !refresh.refreshing.value && refresh.syncedAt.value === beforeFailure)
  panel.value = null
  await refresh.refresh()
  check('No mounted resource panel safely ignores refresh', !refresh.refreshing.value)
  console.log(`PASS ${count} resource tab offline checks`)
} finally { await server.close() }
