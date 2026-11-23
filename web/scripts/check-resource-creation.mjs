// Creation state, result mapping and asynchronous isolation. Local Mock only.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef } from 'vue'

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = [], checks = []
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const manifest = '# creation comment\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: creation-state\n  namespace: default\ndata:\n  value: before\n'
const response = (message = '已创建') => ({ operationId: 'mock-op', status: 'succeeded', items: [{ ref: 'ConfigMap/creation-state', result: 'succeeded', message }] })
try {
  const { useResourceCreation } = await server.ssrLoadModule('/src/composables/useResourceCreation.ts')
  const { createdResourceRows } = await server.ssrLoadModule('/src/utils/resourceCreation.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  function workspace(service) { const cluster = shallowRef('c-prod'), scope = effectScope(); scopes.push(scope); const state = scope.run(() => useResourceCreation({ clusterId: () => cluster.value }, service)); return { cluster, scope, state } }
  const outcomes = createdResourceRows([
    { ref: 'ConfigMap/example', result: 'succeeded', message: '已创建' },
    { ref: 'ConfigMap/example', result: 'succeeded', message: '已更新' },
    { ref: 'Job/broken', result: 'failed', message: '<script>literal failure</script>' },
    { ref: 'Job/skipped', result: 'skipped', message: 'skipped reason' },
    { ref: 'Service/example', result: 'succeeded', message: 'unclassified success' },
    { ref: '', result: 'failed', message: 'invalid identity' },
  ])
  check('Creation and update use distinct per-item statuses', outcomes[0].status === 'created' && outcomes[1].status === 'updated')
  check('Duplicate references retain unique row identities', new Set(outcomes.map(row => row.index)).size === outcomes.length)
  check('Failure text remains literal and attached to its own row', outcomes[2].status === 'failed' && outcomes[2].message === '<script>literal failure</script>')
  check('Skipped results are retained separately from failures', outcomes[3].status === 'skipped' && outcomes[3].message === 'skipped reason')
  check('Unknown success never pretends to be a new resource', outcomes[4].status === 'succeeded')
  check('Missing response identities have explicit placeholders', outcomes[5].kind === '—' && outcomes[5].name === '—')
  check('Empty response remains an empty result list', createdResourceRows([]).length === 0)
  const first = deferred(), calls = []
  const { state, cluster, scope } = workspace({ apply: (...args) => { calls.push(args); return first.promise } })
  check('Creation starts in an empty editor with Apply disabled', state.manifest.value === '' && state.phase.value === 'edit' && !state.canApply.value)
  await state.apply(); check('Empty submit never calls Apply', calls.length === 0)
  state.manifest.value = ' \n\t'; await state.apply(); check('Whitespace-only submit never calls Apply', calls.length === 0)
  state.manifest.value = manifest
  check('Nonempty text can apply without a dry-run prerequisite', state.canApply.value)
  const pending = state.apply(); await state.apply()
  check('Submitting captures the intended cluster and exact input', calls.length === 1 && calls[0][0] === 'c-prod' && calls[0][1].manifest === manifest)
  check('Busy phase blocks duplicate submission', state.busy.value && !state.canApply.value)
  first.resolve(response()); await pending
  check('Success remains in the result phase for user inspection', state.phase.value === 'result' && !state.busy.value)
  check('Success requests a list refresh when drawer closes', state.needsRefresh.value)
  check('Result phase keeps submitted YAML intact', state.manifest.value === manifest)
  check('Result phase exposes the created item', state.rows.value.length === 1 && state.rows.value[0].name === 'creation-state')
  state.edit(); check('Edit YAML returns with the same original draft', state.phase.value === 'edit' && state.manifest.value === manifest)
  check('Returning to edit retains pending refresh from earlier writes', state.needsRefresh.value)
  const failure = deferred(), failed = workspace({ apply: () => failure.promise }).state
  failed.manifest.value = manifest
  const rejected = failed.apply(); failure.reject(new Error('permission denied')); await rejected
  check('Rejected request returns to edit with an explicit error', failed.phase.value === 'edit' && failed.error.value === 'permission denied')
  check('Rejected request preserves full input and permits retry', failed.manifest.value === manifest && failed.canApply.value)
  check('Rejected request never claims a completed creation', !failed.needsRefresh.value && failed.rows.value.length === 0)
  const late = deferred(), isolated = workspace({ apply: () => late.promise })
  isolated.state.manifest.value = manifest; const oldRequest = isolated.state.apply(); isolated.cluster.value = 'c-dev'
  check('Cluster replacement resets editor and busy state immediately', isolated.state.manifest.value === '' && isolated.state.phase.value === 'edit' && !isolated.state.busy.value)
  isolated.state.manifest.value = 'new cluster draft'; late.resolve(response()); await oldRequest
  check('Old cluster completion cannot populate new cluster results', isolated.state.phase.value === 'edit' && isolated.state.rows.value.length === 0 && !isolated.state.needsRefresh.value)
  check('Old cluster completion cannot replace a newer draft', isolated.state.manifest.value === 'new cluster draft')
  const disposed = deferred(), old = workspace({ apply: () => disposed.promise })
  old.state.manifest.value = manifest; const unloading = old.state.apply(); old.scope.stop(); disposed.resolve(response()); await unloading
  check('Disposed creation ignores late completion', !old.state.needsRefresh.value && old.state.rows.value.length === 0)
  const local = workspace({ apply: api.applyResource }).state
  local.manifest.value = manifest; await local.apply()
  check('Direct Mock creation returns a created row', local.rows.value[0]?.status === 'created')
  const resource = await api.getResource('c-prod', '', 'configmaps', 'default', 'creation-state')
  check('Direct Mock creation preserves original comments and newline', resource.manifest === manifest)
  local.edit(); local.manifest.value = manifest.replace('value: before', 'value: after'); await local.apply()
  check('Applying an existing object reports updated', local.rows.value[0]?.status === 'updated')
  local.edit(); local.manifest.value = manifest.replace('creation-state', 'creation-partial') + '---\napiVersion: v1\nkind: ConfigMap\nmetadata: {}\n'; await local.apply()
  check('Partial Mock result keeps every successful and failed item', local.rows.value.length === 2 && local.rows.value[0].status === 'created' && local.rows.value[1].status === 'failed')
  check('Partial result remains inspectable and refreshable', local.phase.value === 'result' && local.needsRefresh.value)
  local.edit(); local.manifest.value = 'metadata: [broken'; await local.apply()
  check('Malformed YAML returns to editor with original input', local.phase.value === 'edit' && local.manifest.value === 'metadata: [broken' && local.error.value.includes('YAML'))
  check('Later request failure retains refresh from earlier partial writes', local.needsRefresh.value)
  check('Later request failure clears the old result rows', local.rows.value.length === 0)
  cluster.value = 'c-dev'; check('Fresh cluster never retains prior refresh state', !state.needsRefresh.value)
  scope.stop()
  console.log(`${checks.length} resource creation offline checks passed; frontend Mock only`)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
