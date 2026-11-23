// Offline Mock lifecycle and node-state checks. Does not execute shell commands.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, nextTick, shallowRef } from 'vue'
import { resolve } from 'node:path'
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = []
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve() } }
const result = id => ({ sessionId: id, clusterId: 'c-prod', namespace: 'default', container: 'mock', shell: 'bash', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString() })
try {
  const utils = await server.ssrLoadModule('/src/utils/clusterTerminal.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { useClusterTerminal } = await server.ssrLoadModule('/src/composables/useClusterTerminal.ts')
  const nodes = ['prod-node-01', 'prod-node-02'], namespaces = ['default', 'shop-prod']
  const selection = shallowRef(utils.terminalSelection({ node: nodes[1], namespace: namespaces[1], image: 'public/tool:v1', shell: 'sh' }, nodes, namespaces))
  check('Deep link preserves all four terminal selectors', selection.value.node === nodes[1] && selection.value.namespace === namespaces[1] && selection.value.image === 'public/tool:v1' && selection.value.shell === 'sh')
  const fallback = utils.terminalSelection({ node: 'foreign', shell: 'powershell', image: ['invalid'] }, nodes, namespaces)
  check('Unknown node and unsupported shell safely fall back', fallback.node === utils.AUTO_NODE && fallback.shell === 'bash' && fallback.image === utils.CLUSTER_TERMINAL_IMAGES[0].value)
  check('Custom namespace preserved for creatable picker', utils.terminalSelection({ namespace: 'custom' }, nodes, namespaces).namespace === 'custom')
  check('Invalid namespace rejected before connection', !!utils.terminalSelectionError({ ...selection.value, namespace: 'Invalid Namespace' }))
  check('Image command substitution is rejected', !!utils.terminalSelectionError({ ...selection.value, image: '$(whoami)' }))
  const pod = utils.createDebugPod(selection.value, nodes[1], true, 1)
  check('Debug manifest includes node and host access fields', pod.manifest.includes(nodes[1]) && pod.manifest.includes('privileged: true') && pod.manifest.includes('hostPID: true') && pod.manifest.includes('/host'))
  check('Regular debug Pod omits privileged host fields', !utils.createDebugPod(selection.value, nodes[1], false, 2).manifest.includes('privileged'))
  check('Selected node taints become debug Pod tolerations', utils.createDebugPod(selection.value, nodes[1], false, 3, [{ key: 'node-role.kubernetes.io/control-plane', value: '', effect: 'NoSchedule' }]).manifest.includes('operator: Exists'))
  check('Manifest identity cannot move to another namespace', !!utils.validateDebugManifest(pod.manifest.replace('namespace: shop-prod', 'namespace: other'), pod))
  check('Manifest cannot silently change selected node', !!utils.validateDebugManifest(pod.manifest.replace('nodeName: prod-node-02', 'nodeName: prod-node-01'), pod))
  check('Malformed manifest rejected', !!utils.validateDebugManifest('spec: [', pod))
  check('Empty containers rejected', !!utils.validateDebugManifest(pod.manifest.replace(/containers:[\s\S]*/, 'containers: []\n'), pod))
  check('Manifest metadata edits allowed', !utils.validateDebugManifest(pod.manifest.replace('podry-debug\n', 'podry-debug-updated\n'), pod))
  const requests = [], closed = [], commands = []
  const services = { create: async (id, input) => { const request = deferred(); requests.push({ id, input, ...request }); return request.promise }, close: async id => { closed.push(id) }, namespaces: async () => [{ name: 'default', phase: 'Active' }], resources: async (id, query) => { const request = deferred(); commands.push({ id, query, ...request }); return request.promise } }
  const clusterId = shallowRef('c-prod'), debug = shallowRef(false)
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useClusterTerminal({ clusterId: () => clusterId.value, clusterName: () => 'production', selection: () => selection.value, nodes: () => nodes, debug: () => debug.value }, services))
  check('Initial request captures namespace and shell', requests[0].input.namespace === 'shop-prod' && requests[0].input.shell === 'sh')
  selection.value = { ...selection.value, node: nodes[0] }; await flush()
  requests[0].resolve(result('stale')); await flush()
  check('Late successful session is released', closed.includes('stale') && !state.session.value)
  requests[1].resolve(result('current')); await flush()
  check('Current request connects to selected node', state.session.value.sessionId === 'current' && state.selectedNode.value === nodes[0] && state.pod.value.manifest.includes(nodes[0]))
  state.input.value = 'kubectl get pods -n shop-prod'; const command = state.submit(); await flush()
  check('Commands use captured cluster and namespace', commands[0].id === 'c-prod' && commands[0].query.namespace === 'shop-prod')
  state.interrupt(); commands[0].resolve([{ ref: { name: 'late-output', namespace: 'shop-prod' }, status: 'Running' }]); await command
  check('Interrupted response cannot append late output', !state.lines.value.some(line => line.includes('late-output')) && !state.busy.value)
  state.input.value = 'unsent draft'; state.recall(-1); check('Up recalls command', state.input.value === 'kubectl get pods -n shop-prod'); state.recall(1)
  check('Down restores unsent draft', state.input.value === 'unsent draft')
  state.input.value = 'kubectl get namespaces'; await state.submit()
  check('Namespace command displays local result', state.lines.value.some(line => line.includes('Active')))
  state.input.value = 'kubectl delete pods --all; whoami'; await state.submit()
  check('Destructive commands are displayed as unsupported', state.lines.value.at(-1).includes('unsupported command'))
  state.input.value = 'kubectl get pods -A'; const allCommand = state.submit(); await flush(); check('All namespaces flag removes namespace filter', commands[1].query.namespace === undefined); commands[1].resolve([]); await allCommand
  check('Empty result is explicit', state.lines.value.at(-1) === 'No resources found.')
  const oldPod = state.pod.value, oldUid = oldPod.ref.uid
  const applying = state.applyManifest(oldPod.manifest + '# reviewed\n'); await flush()
  check('Apply releases former session', closed.includes('current'))
  requests[2].resolve(result('recreated')); check('Apply resolves success', await applying)
  check('Apply recreates identity and retains edited content', state.pod.value.ref.uid !== oldUid && state.pod.value.manifest.endsWith('# reviewed\n') && state.events.value.length === 4)
  check('Apply retains hidden managed fields', state.pod.value.manifest.includes('managedFields'))
  const reviewedPod = state.pod.value, reviewedEvents = state.events.value
  state.disconnect(); const resume = state.connect(); await flush(); requests[3].resolve(result('resumed')); await resume
  check('Resume preserves reviewed Pod and original lifecycle events', state.pod.value.ref.uid === reviewedPod.ref.uid && state.pod.value.manifest === reviewedPod.manifest && state.events.value === reviewedEvents)
  selection.value = { ...selection.value, shell: 'bash' }; await flush(); requests[4].resolve(result('shell-change')); await flush()
  check('Shell change reconnects existing debug Pod', state.pod.value.ref.uid === reviewedPod.ref.uid && requests[4].input.shell === 'bash')
  debug.value = true; await flush(); requests[5].reject(new Error('mock connection refused')); await flush()
  check('Connection failure is visible and no active session retained', state.status.value === 'error' && state.error.value.includes('refused') && !state.session.value)
  const retry = state.connect(); await flush(); requests[6].resolve(result('retry')); await retry
  check('Retry recovers from connection failure', state.connected.value && !state.error.value)
  const pending = state.connect(); await flush(); scope.stop(); requests[7].resolve(result('after-dispose')); await pending
  check('Unmount closes connected and late sessions', closed.includes('retry') && closed.includes('after-dispose'))
  const expiringScope = effectScope(); scopes.push(expiringScope)
  const expired = expiringScope.run(() => useClusterTerminal({ clusterId: () => 'c-prod', clusterName: () => 'prod', selection: () => selection.value, nodes: () => nodes, debug: () => false }, { ...services, create: async () => ({ ...result('expired'), expiresAt: new Date(Date.now() - 1).toISOString() }) }))
  await new Promise(resolve => setTimeout(resolve, 20))
  check('Expired session disconnects and releases ownership', expired.status.value === 'expired' && !expired.session.value && closed.includes('expired'))
  expiringScope.stop()
  const node = await api.getNodeDetail('c-prod', nodes[0]), resource = await api.getResource('c-prod', '', 'nodes', '_cluster', nodes[0])
  check('Node detail and resource share initial Manifest', node.manifest === resource.manifest)
  const edited = resource.manifest.replace('unschedulable: false', 'unschedulable: true').replace('node.alpha.kubernetes.io/ttl: "0"', 'node.alpha.kubernetes.io/ttl: "7"')
  const applied = await api.applyResource('c-prod', { manifest: edited, expectedUid: resource.ref.uid, expectedManifest: resource.manifest })
  const updated = await api.getNodeDetail('c-prod', nodes[0])
  check('Node YAML apply synchronizes summary scheduling', applied.status === 'succeeded' && updated.unschedulable && updated.manifest === edited)
  check('Node annotations reflect saved YAML', updated.annotations.includes('node.alpha.kubernetes.io/ttl=7'))
  const invalid = await api.dryRunResource('c-prod', { manifest: edited.replace('unschedulable: true', 'unschedulable: "true"') })
  check('Invalid scheduling type rejected locally', !invalid.valid)
  const invalidApply = await api.applyResource('c-prod', { manifest: edited.replace('taints: []', 'taints: invalid') })
  check('Invalid taints do not mutate saved node', invalidApply.status === 'failed' && (await api.getNodeDetail('c-prod', nodes[0])).manifest === edited)
  await assert.rejects(api.getNodeDetail('c-dev', nodes[0])); check('Cross-cluster node not exposed', true)
  const pods = [{ name: 'b', namespace: 'default', cpuRequest: '10%', age: '2h' }, { name: 'a', namespace: 'default', cpuRequest: '2%', age: '30m' }]
  check('Pod percentage sorts numerically', utils.sortedNodePods(pods, 'cpuRequest', false)[0].name === 'a')
  check('Pod age sorts by duration', utils.sortedNodePods(pods, 'age', true)[0].name === 'b')
  check('Pod sorting preserves input order', pods[0].name === 'b')
  console.log(`Passed ${count} cluster terminal and node Mock checks`)
} finally { for (const scope of scopes) scope.stop(); await server.close() }
