// Desired/live comparison rules and isolated Mock behavior, not Kubernetes drift prediction.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'
import { resolve } from 'node:path'
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = []
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
try {
  const { resourceComparisonView, normalizeComparisonManifest } = await server.ssrLoadModule('/src/utils/resourceManifestComparison.ts')
  const { resourceManifestDiff } = await server.ssrLoadModule('/src/utils/resourceManifest.ts')
  const { useResourceManifestComparison } = await server.ssrLoadModule('/src/composables/useResourceManifestComparison.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const resource = await api.getResource('c-dev', 'apps', 'deployments', 'shop-dev', 'checkout-api')
  const snapshot = await api.getDesiredResourceManifest('c-dev', resource.ref)
  check('Initial fixture has a separately captured desired state', snapshot.source === 'mock-fixture' && snapshot.resourceUid === resource.ref.uid && snapshot.manifest === resource.manifest)
  check('Identical desired/live state has no drift or changes', !resourceComparisonView(resource, snapshot).drift && resourceComparisonView(resource, snapshot).diff.hunks.length === 0)
  snapshot.manifest = snapshot.manifest.replace('replicas: 1', 'replicas: 7')
  check('Returned desired state cannot mutate its source snapshot', (await api.getDesiredResourceManifest('c-dev', resource.ref)).manifest === resource.manifest)
  const baseline = await api.getDesiredResourceManifest('c-dev', resource.ref)
  const changed = resource.manifest.replace('replicas: 1', 'replicas: 3').replace('v1.42.0', 'v2.0.0')
  await api.applyResource('c-dev', { manifest: changed, expectedUid: resource.ref.uid, expectedManifest: resource.manifest })
  const live = await api.getResource('c-dev', 'apps', 'deployments', 'shop-dev', 'checkout-api')
  const stillDesired = await api.getDesiredResourceManifest('c-dev', live.ref)
  check('Applying a live edit never rewrites desired snapshot', stillDesired.manifest === baseline.manifest && !stillDesired.manifest.includes('replicas: 3'))
  const comparison = resourceComparisonView(live, stillDesired)
  check('Replicas and image edits remain meaningful differences', comparison.drift && comparison.diff.hunks.length === 2 && comparison.live.includes('replicas: 3') && comparison.desired.includes('replicas: 1'))
  const pod = await api.getResource('c-dev', '', 'pods', 'shop-dev', 'checkout-api-5b8d7c9f4-t1n9p')
  check('Controller-owned Pod has no independent desired snapshot', await api.getDesiredResourceManifest('c-dev', pod.ref) === null)
  await assert.rejects(api.getDesiredResourceManifest('c-prod', live.ref), /资源不存在/); check('Desired state cannot be read through another cluster', true)
  await assert.rejects(api.getDesiredResourceManifest('c-dev', { ...live.ref, uid: 'stale-uid' }), /重建/); check('Recreated UID requires a fresh detail read', true)
  const simple = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n  namespace: default\ndata:\n  A: one\n  B: "2"\n'
  const reordered = 'kind: ConfigMap\ndata: {B: "2", A: one}\nmetadata: {namespace: default, name: test}\napiVersion: v1\n'
  check('Mapping order, flow style and comments do not produce drift', normalizeComparisonManifest(simple) === normalizeComparisonManifest('# comment\n' + reordered))
  const withServerFields = simple.replace('  namespace: default', '  namespace: default\n  uid: server-uid\n  resourceVersion: "25"\n  generation: 7\n  creationTimestamp: "2026-11-23T00:00:00Z"\n  managedFields: [{manager: kube-controller-manager}]\n  annotations: {kubectl.kubernetes.io/last-applied-configuration: ignored}') + 'status: {phase: Ready}\n'
  check('Runtime metadata and status do not produce configuration drift', normalizeComparisonManifest(simple) === normalizeComparisonManifest(withServerFields))
  check('Same-named business managedFields and status remain', normalizeComparisonManifest(simple + 'status: {data: ignored}\n').includes('A: one') && normalizeComparisonManifest(simple.replace('  A: one', '  A: one\n  managedFields: keep\n  status: keep-too')).includes('status: keep-too'))
  check('Array order remains meaningful', normalizeComparisonManifest(simple + 'items: [one, two]\n') !== normalizeComparisonManifest(simple + 'items: [two, one]\n'))
  check('Scalar types remain meaningful', normalizeComparisonManifest(simple) !== normalizeComparisonManifest(simple.replace('B: "2"', 'B: 2')))
  assert.throws(() => normalizeComparisonManifest('x: &loop [*loop]'), /循环/); check('Cyclic aliases fail without recursive overflow', true)
  assert.throws(() => normalizeComparisonManifest('x: [broken'), /YAML/); check('Invalid YAML has an explicit comparison error', true)
  assert.throws(() => resourceComparisonView(resource, { ...baseline, resourceUid: 'other' }), /不属于/); check('Snapshot UID mismatch never compares unrelated objects', true)
  assert.throws(() => resourceComparisonView(resource, { ...baseline, manifest: baseline.manifest.replace('name: checkout-api', 'name: another') }), /期望.*metadata.name/); check('Snapshot identity mismatch never compares unrelated objects', true)
  const h = resourceManifestDiff('a\nb\nc\nd\ne\nf', 'a\nx\nb\nc\nd\ny\nf')
  check('Separated insertion and replacement produce navigable hunks', h.hunks.length === 2 && h.hunks[0].leftStart === 2 && h.hunks[0].rightStart === 2 && h.hunks[0].leftCount === 0 && h.hunks[1].leftStart === 5)
  check('Tail deletion has a valid right pane anchor', resourceManifestDiff('a\nb', 'a').hunks[0].rightStart === 1)
  const long = Array.from({ length: 1000 }, (_, i) => `line-${i}`)
  const longAfter = [...long]; longAfter[500] = 'changed'
  check('Large comparison retains bounded memory and navigation', resourceManifestDiff(long.join('\n'), longAfter.join('\n')).hunks[0].leftStart === 501)
  const current = shallowRef(resource), cluster = shallowRef('c-dev')
  const pending = []
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useResourceManifestComparison({ resource: () => current.value, clusterId: () => cluster.value }, () => { const task = deferred(); pending.push(task); return task.promise }))
  check('Opening starts a desired snapshot read', state.loading.value && pending.length === 1)
  cluster.value = 'other'; await nextTick()
  pending[0].resolve(baseline); await nextTick(); await nextTick()
  check('Late response from a previous cluster cannot populate view', state.snapshot.value === null && state.loading.value)
  pending[1].reject(Error('retryable')); await nextTick(); await nextTick()
  check('Read errors remain visible and clear loading state', state.error.value === 'retryable' && !state.loading.value)
  const retry = state.reload(); pending[2].resolve(null); await retry
  check('Missing desired snapshot remains empty rather than copying live', state.snapshot.value === null && state.view.value === null && !state.error.value)
  const success = state.reload(); pending[3].resolve(baseline); await success
  check('Retry restores comparison from the immutable desired source', state.view.value && !state.view.value.drift && !state.error.value)
  current.value = live; await nextTick()
  check('Live updates recompute differences without overwriting desired or reloading it', state.view.value.drift && pending.length === 4 && state.snapshot.value.manifest === baseline.manifest)
  const last = state.reload(); scope.stop(); pending[4].resolve(baseline); await last
  check('Disposed comparison ignores pending response', state.snapshot.value === null)
  console.log(`${count} resource comparison checks passed`)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
