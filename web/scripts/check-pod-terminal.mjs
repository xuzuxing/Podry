// Offline Mock session ownership, command and lifecycle checks. No real shell or Kubernetes.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'
import { resolve } from 'node:path'
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = []
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function flush() { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve() } }
try {
  const utils = await server.ssrLoadModule('/src/utils/podTerminal.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const db = await server.ssrLoadModule('/src/mock/data.ts')
  const { usePodTerminal } = await server.ssrLoadModule('/src/composables/usePodTerminal.ts')
  const pod = structuredClone(db.resources.find(item => item.ref.uid === 'uid-pod-3'))
  check('Four shells follow upstream order', utils.POD_SHELLS.join() === 'sh,bash,powershell,cmd')
  check('Shell validation rejects arbitrary commands', !utils.isPodShell('sh; curl mock'))
  check('Running main and ephemeral containers available', !utils.podTerminalError(pod, 'app') && !utils.podTerminalError(pod, 'debugger'))
  check('Known completed init container unavailable', utils.podTerminalError(pod, 'migrate').includes('Completed'))
  check('Waiting container explains its reason', utils.podTerminalError({ ...pod, manifest: pod.manifest.replace("state: {running: {startedAt: '2026-11-20T09:40:00Z'}}", 'state: {waiting: {reason: ContainerCreating}}') }, 'app').includes('ContainerCreating'))
  check('Running sidecar remains available when another container crashes', !utils.podTerminalError({ ...pod, status: 'CrashLoopBackOff' }, 'envoy'))
  check('Environment names are not containers', utils.podTerminalError(pod, 'LOG_LEVEL').includes('不存在'))
  check('Non-Pods unavailable', utils.podTerminalError({ ...pod, kind: 'Deployment' }, 'app').includes('只有 Pod'))
  check('Known unavailable Pod phase explained', utils.podTerminalError({ ...pod, status: 'Failed', manifest: pod.manifest.replace('phase: Running', 'phase: Failed') }, 'app').includes('Failed'))
  check('Malformed manifest does not invent containers', !!utils.podTerminalError({ ...pod, manifest: 'spec: [invalid' }, 'app'))
  check('Windows shell prompt', utils.terminalPrompt('powershell') === 'PS C:\\app>' && utils.terminalPrompt('cmd') === 'C:\\app>')
  check('Shell substitution echoed literally', utils.mockTerminalCommand('echo $(curl attacker); <script>x</script>', 'sh').lines[0] === '$(curl attacker); <script>x</script>')
  check('Unknown command never executed', utils.mockTerminalCommand('kubectl delete pods --all', 'bash').lines[0].includes('command not found'))
  check('Clear and exit are explicit actions', utils.mockTerminalCommand('cls', 'cmd').clear && utils.mockTerminalCommand('exit', 'sh').exit)
  const target = { namespace: pod.ref.namespace, pod: pod.ref.name, resourceUid: pod.ref.uid, container: 'envoy', shell: 'bash' }
  const first = await api.createExecSession('c-dev', target)
  check('Mock session captures selected container and shell', first.container === 'envoy' && first.shell === 'bash' && first.clusterId === 'c-dev')
  check('Session expires in thirty minutes', +new Date(first.expiresAt) - +new Date(first.createdAt) === 1800000)
  await api.closeExecSession(first.sessionId)
  await assert.rejects(api.closeExecSession(first.sessionId), /会话不存在/); check('Close releases Mock session', true)
  await assert.rejects(api.createExecSession('c-prod', target), /Pod 不存在/); check('Cross-cluster Pod identity rejected', true)
  await assert.rejects(api.createExecSession('c-dev', { ...target, resourceUid: 'replaced-uid' }), /重新创建/); check('Recreated Pod UID rejected', true)
  await assert.rejects(api.createExecSession('c-dev', { ...target, container: 'LOG_LEVEL' }), /容器不存在/); check('Mock boundary validates container', true)
  await assert.rejects(api.createExecSession('c-dev', { ...target, container: 'migrate' }), /已终止/); check('Mock boundary validates terminated state', true)
  await assert.rejects(api.createExecSession('c-dev', { ...target, shell: 'zsh' }), /不支持/); check('Mock boundary validates shell', true)
  const concurrent = await Promise.all([api.createExecSession('c-dev', target), api.createExecSession('c-dev', target)])
  check('Concurrent session IDs are unique', concurrent[0].sessionId !== concurrent[1].sessionId)
  await Promise.all(concurrent.map(item => api.closeExecSession(item.sessionId)))
  const admin = await api.createExecSession('c-prod', { namespace: 'default', container: 'kubectl' })
  check('Existing cluster terminal remains compatible', admin.pod === null && admin.container === 'kubectl' && admin.shell === 'sh'); await api.closeExecSession(admin.sessionId)

  const resource = shallowRef(pod), active = shallowRef(false), cluster = shallowRef('c-dev'), initial = shallowRef('envoy')
  const pending = [], closed = []
  const scope = effectScope(); scopes.push(scope)
  let state
  scope.run(() => { state = usePodTerminal({ resource: () => resource.value, active: () => active.value, clusterId: () => cluster.value, initialContainer: () => initial.value, create: (clusterId, input) => { const task = deferred(); pending.push({ ...task, clusterId, input }); return task.promise }, close: async id => { closed.push(id) } }) })
  const resolve = (task, id) => task.resolve({ ...first, ...task.input, clusterId: task.clusterId, sessionId: id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString() })
  await flush()
  check('Inactive workspace never creates session', pending.length === 0 && state.container.value === 'envoy')
  active.value = true; await flush(); const stale = pending.at(-1)
  check('Deep linked container used for first connection', stale.input.container === 'envoy' && stale.input.resourceUid === pod.ref.uid)
  state.container.value = 'app'; await flush(); const latest = pending.at(-1)
  resolve(latest, 'latest'); await flush(); resolve(stale, 'stale'); await flush()
  check('Late connection cannot overwrite current session', state.session.value.sessionId === 'latest' && state.lines.value[0].includes('/ app'))
  check('Superseded session is closed', closed.includes('stale'))
  state.input.value = 'echo one'; state.submit(); state.input.value = 'draft'; state.recall(-1)
  check('History recalls command', state.input.value === 'echo one'); state.recall(1)
  check('History restores unsent draft', state.input.value === 'draft')
  state.interrupt(); check('Ctrl+C clears input without disconnecting', state.input.value === '' && state.connected.value && state.lines.value.at(-1).endsWith('draft^C'))
  state.clear(); check('Clear retains connection', !state.lines.value.length && state.session.value.sessionId === 'latest')
  active.value = false; await flush(); active.value = true; await flush()
  check('Tab return retains established session', state.session.value.sessionId === 'latest' && pending.at(-1) === latest)
  state.shell.value = 'bash'; await flush(); const shellRequest = pending.at(-1)
  check('Shell change releases previous session and disables input', closed.includes('latest') && !state.connected.value && shellRequest.input.shell === 'bash')
  state.disconnect(); resolve(shellRequest, 'cancelled'); await flush()
  check('Disconnect while connecting closes late session', !state.session.value && closed.includes('cancelled') && state.status.value === 'disconnected')
  const retry = state.connect(); await flush(); pending.at(-1).reject(new Error('mock connect failed')); await retry
  check('Connection failure remains retryable', state.status.value === 'error' && state.error.value === 'mock connect failed')
  const reconnect = state.connect(); await flush(); resolve(pending.at(-1), 'recovered'); await reconnect
  check('Reconnect clears error and history', state.connected.value && !state.error.value && !state.input.value)
  state.expire(Date.now() + 1800100); await flush()
  check('Expired session releases and disables command entry', state.status.value === 'expired' && !state.session.value && closed.includes('recovered'))
  const n = pending.length; state.container.value = 'migrate'; await flush()
  check('Completed init reports reason without creating session', state.error.value.includes('Completed') && pending.length === n)
  state.container.value = 'envoy'; await flush(); const hidden = pending.at(-1); active.value = false; await flush(); resolve(hidden, 'hidden'); await flush()
  check('Hiding pending terminal closes late response', !state.session.value && closed.includes('hidden') && state.status.value === 'idle')
  active.value = true; await flush(); const departing = pending.at(-1)
  resource.value = { ...pod, ref: { ...pod.ref, uid: 'another-pod', name: 'another-pod' } }; await flush(); resolve(departing, 'departing'); await flush()
  check('Resource change invalidates old request', closed.includes('departing') && !state.session.value && !state.lines.value.length)
  const disposed = pending.at(-1); scope.stop(); resolve(disposed, 'disposed'); await flush()
  check('Unmount closes pending successful session', closed.includes('disposed') && !state.session.value)
  console.log(`Passed ${count} Pod terminal checks`)
} finally { for (const scope of scopes) scope.stop(); await server.close() }
