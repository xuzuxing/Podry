// Offline resource scoping, partial failure and stale request checks. No cluster connection.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = []
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const flush = async () => { for (let i = 0; i < 5; i++) await nextTick() }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
try {
  const utils = await server.ssrLoadModule('/src/utils/logAnalyzer.ts')
  const { useLogAnalyzer } = await server.ssrLoadModule('/src/composables/useLogAnalyzer.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const db = await server.ssrLoadModule('/src/mock/data.ts')
  const resources = await api.listApplicationResources('a-checkout', 'b-checkout-dev')
  const options = utils.analyzerPodOptions(resources)
  const group = options.find(item => item.group)
  check('ReplicaSet owner chain resolves to Deployment workload', group.value === `workload:${resources.find(item => item.kind === 'Deployment' && item.ref.name === 'checkout-api').ref.uid}`)
  check('Workload includes exactly two dev replicas', group.pods.length === 2 && group.pods.every(pod => pod.ref.namespace === 'shop-dev'))
  check('Grouped and individual pod choices are available', options.length === 3 && options.filter(item => !item.group).length === 2)
  check('Containers are actual spec entries across selected pods', utils.analyzerContainers(group.pods).map(item => item.name).join(',') === 'app,debugger,envoy,migrate')
  const orphan = structuredClone(group.pods[0]); orphan.ref.uid = 'orphan'; orphan.ownerRefs = []
  check('Ownerless Pod remains selectable without invented workload', utils.analyzerPodOptions([orphan]).length === 1 && !utils.analyzerPodOptions([orphan])[0].group)
  const missing = structuredClone(orphan); missing.ownerRefs = ['Job/missing']; missing.ref.uid = 'missing'
  check('Missing parent retains exact owner fallback scope', utils.analyzerPodOptions([missing])[0].value === 'owner:shop-dev/Job/missing')
  const foreign = structuredClone(resources.find(item => item.kind === 'ReplicaSet')); foreign.ref.namespace = 'foreign'; foreign.ref.uid = 'foreign'; foreign.ownerRefs = []
  check('Owner lookup cannot cross namespace', !utils.analyzerPodOptions([group.pods[0], foreign])[0].value.includes('foreign'))
  const cycle = structuredClone(orphan); cycle.ownerRefs = [`Pod/${cycle.ref.name}`]
  check('Cyclic owner graph terminates and preserves individual Pod', utils.analyzerPodOptions([cycle]).length === 1)
  const source = (pod, lines) => ({ uid: pod, pod, lines, error: '', unavailable: false })
  const streams = [source('a', ['before', 'ERROR failure']), source('b', ['unrelated', 'end'])]
  check('Grep contexts cannot consume lines from another Pod', utils.filterAnalyzerSources(streams, 'grep -A 2 ERROR').lines.join() === 'a: ERROR failure')
  check('Pod prefix is searchable with independent context', utils.filterAnalyzerSources(streams, 'grep -B 1 "a: ERROR"').lines.join() === 'a: before,a: ERROR failure')
  check('Invalid grep is reported even with empty sources', !!utils.filterAnalyzerSources([], 'grep -x bad').error)
  check('Literal markup is never interpreted', utils.filterAnalyzerSources([source('a', ['<script>literal</script>'])], '<script>').lines[0] === 'a: <script>literal</script>')

  const active = shallowRef(true), items = shallowRef(resources), refresh = shallowRef(0), pending = []
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useLogAnalyzer({ resources: () => items.value, active: () => active.value, refreshKey: () => refresh.value, read: (uid, options) => { const task = { uid, options, ...deferred() }; pending.push(task); return task.promise } }))
  await flush()
  check('Defaults to first workload and one concrete container', state.selectedPods.value.length === 2 && state.container.value === 'app')
  check('Parallel reads target each selected Pod once', pending.length === 2 && new Set(pending.map(item => item.uid)).size === 2)
  pending.forEach((task, index) => task.resolve(['initial-' + index])); await flush()
  check('Each successful stream retains source identity', state.sources.value.length === 2 && state.sources.value.every(item => item.lines.length === 1))
  state.appendMockLine(1234567890000)
  check('Live Mock prints once per successful main container', state.sources.value.every(item => item.lines.length === 2 && item.lines[1].includes('[Mock/app]')))
  state.paused.value = true; state.appendMockLine(); check('Pause stops all Pod streams', state.sources.value.every(item => item.lines.length === 2))
  state.clear(); check('Clear keeps selected streams without reconnecting', state.sources.value.length === 2 && state.sources.value.every(item => !item.lines.length) && pending.length === 2)
  state.paused.value = false; state.appendMockLine(); check('Clear resumes from new records only', state.sources.value.every(item => item.lines.length === 1 && !item.lines[0].includes('initial')))
  state.previous.value = true; await flush()
  const prevTasks = pending.slice(-2)
  prevTasks[0].reject(new api.MockError('previous_logs_unavailable', 'missing previous', 404)); prevTasks[1].resolve(['previous replica']); await flush()
  check('One failed Pod cannot hide another Pod history', state.successful.value.length === 1 && state.failures.value.length === 1 && state.successful.value[0].lines[0] === 'previous replica')
  check('Unavailable previous logs are classified explicitly', state.failures.value[0].unavailable)
  state.appendMockLine(); check('Previous instance never gets current live records', state.successful.value[0].lines.length === 1 && !state.canStream.value)
  state.chooseContainer('debugger'); await flush()
  check('Missing container Pods are skipped before requesting', state.targets.value.length === 1 && !state.previous.value && pending.at(-1).options.container === 'debugger')
  pending.at(-1).resolve(['ephemeral']); await flush(); state.appendMockLine()
  check('Ephemeral log history stays static', state.sources.value[0].lines.join() === 'ephemeral' && !state.canStream.value)
  const replicaOption = options.find(item => !item.group && item.pods[0].ref.uid === 'uid-pod-checkout-replica')
  state.choosePod(replicaOption.value); await flush()
  check('Switching to incompatible Pod requires explicit container', !state.container.value && !state.sources.value.length && !state.loading.value)
  state.chooseContainer('app'); await flush(); const stale = pending.at(-1)
  state.chooseContainer('envoy'); await flush(); pending.at(-1).resolve(['latest envoy']); await flush(); stale.resolve(['stale app']); await flush()
  check('Late response cannot overwrite newer container selection', state.sources.value[0].lines.join() === 'latest envoy')
  state.range.value = { type: 'lines', value: 2 }; await flush(); pending.at(-1).resolve(['one', 'two']); await flush(); state.appendMockLine()
  check('Per-Pod range constrains live retention', state.sources.value[0].lines.length === 2 && pending.at(-1).options.tailLines === 2)
  state.range.value = { type: 'since', value: 1000 }; await flush()
  check('Absolute time maps to sinceTime without tail or duration', pending.at(-1).options.sinceTime === new Date(1000).toISOString() && !('tailLines' in pending.at(-1).options) && !('sinceSeconds' in pending.at(-1).options))
  const hidden = pending.at(-1); active.value = false; await flush(); hidden.resolve(['hidden stale']); await flush()
  check('Inactive analyzer invalidates reads and stops streams', !state.sources.value.length && !state.loading.value && !state.canStream.value)
  active.value = true; await flush(); pending.at(-1).reject(new Error('broken stream')); await flush()
  check('Network failure remains visible and retryable', state.failures.value[0].error === 'broken stream' && !state.failures.value[0].unavailable)
  refresh.value++; await flush(); pending.at(-1).resolve(['reconnected']); await flush()
  check('External refresh replays current scoped source', state.sources.value[0].lines.join() === 'reconnected')
  const changed = pending.length; state.choosePod('unknown'); state.chooseContainer('unknown'); await flush()
  check('Invalid selectors cannot trigger reads', pending.length === changed)
  state.choosePod(group.value); await flush(); const environmentRequests = pending.slice(-2)
  items.value = []; await flush(); environmentRequests.forEach(item => item.resolve(['old environment'])); await flush()
  check('Resource removal clears selection and stale environment results', !state.pod.value && !state.container.value && !state.sources.value.length)
  items.value = resources; await flush(); const disposed = pending.slice(-2); scope.stop(); disposed.forEach(item => item.resolve(['disposed'])); await flush()
  check('Unmount ignores pending results', !state.sources.value.length)

  const replica = group.pods.find(item => item.ref.uid === 'uid-pod-checkout-replica')
  const current = await api.getPodLogs(replica.ref.uid, { container: 'app' })
  const old = await api.getPodLogs(replica.ref.uid, { container: 'app', previous: true })
  check('Replica fixtures use independent current and previous histories', current.length === 4 && old.length === 2 && old.every(line => line.includes('previous')))
  check('Prod binding excludes both dev replicas', !(await api.listApplicationResources('a-checkout', 'b-checkout-prod')).some(item => item.ref.uid === replica.ref.uid))
  console.log(`Passed ${count} offline Log Analyzer checks`)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
