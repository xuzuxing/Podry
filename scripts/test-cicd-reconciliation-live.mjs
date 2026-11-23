// Explicit reconciliation of an existing ambiguous release. Never submits Helm.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, deployment: { type: 'string' }, output: { type: 'string' },
  kubeconfig: { type: 'string' }, 'insecure-kubernetes': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=<token> node scripts/test-cicd-reconciliation-live.mjs --api http://127.0.0.1:15001 --deployment UUID --kubeconfig docs/k3s.yaml --output /outside/reconciliation.json [--insecure-kubernetes]');
  console.log('Requires an existing unknown release and quiescent workers. Persists the original revision/key before POST, checks ambiguous-result retention, byte-identical replay, changed-input and stale-revision rejection, and unchanged Helm records/root specifications. Reusing output replays the same operation. Does not submit, unlock, or clean resources; cannot replace Kubernetes audit evidence.');
  process.exit(0);
}
for (const name of ['api', 'deployment', 'output', 'kubeconfig']) assert(options[name], `--${name} is required`);
assert.match(options.deployment, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const base = new URL(options.api);
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'API must be an exact HTTP(S) origin');
const token = process.env.PODRY_LIVE_TOKEN;
assert(token && !/[\r\n]/.test(token), 'PODRY_LIVE_TOKEN is required');
const output = resolve(options.output);
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
state ??= { schemaVersion: 1, api: base.origin, deploymentId: options.deployment, runId: randomUUID(), startedAt: new Date().toISOString() };
assert(state.schemaVersion === 1 && state.api === base.origin && state.deploymentId === options.deployment, 'Evidence belongs to another API or deployment');
await mkdir(dirname(output), { recursive: true });
async function save() {
  await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(output + '.tmp', output);
}
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function api(method, path, body, expected = 200, key) {
  const r = await fetch(new URL('/api' + path, base), { method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: {
    Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const chunks = []; let size = 0;
  for await (const b of r.body ?? []) { size += b.length; assert(size <= 4 << 20, 'Response too large'); chunks.push(b); }
  const bytes = Buffer.concat(chunks); let data;
  try { data = JSON.parse(bytes); } catch { throw new Error(`${method} ${path}: non-JSON (${r.status})`); }
  assert.equal(r.status, expected, `${method} ${path}: ${r.status} ${data.error?.code ?? ''}`);
  return { data, sha256: hash(bytes) };
}
function kube(args) {
  const r = spawnSync('kubectl', ['--kubeconfig', resolve(options.kubeconfig), '--request-timeout=25s', ...(options['insecure-kubernetes'] ? ['--insecure-skip-tls-verify=true'] : []), ...args], { encoding: 'utf8', windowsHide: true, timeout: 35000, maxBuffer: 8 << 20 });
  assert.equal(r.status, 0, 'Kubernetes read failed; inspect cluster connectivity');
  return JSON.parse(r.stdout);
}
function clusterEvidence(target) {
  // Read release storage in memory, persist only metadata. Never save Secret data.
  const secrets = kube(['-n', target.namespace, 'get', 'secrets', '-l', `owner=helm,name=${target.releaseName}`, '-o', 'json']).items;
  const roots = kube(['-n', target.namespace, 'get', 'deployments,jobs,services', '-l', `app.kubernetes.io/instance=${target.releaseName}`, '-o', 'json']).items;
  const metadata = o => ({ name: o.metadata.name, uid: o.metadata.uid, resourceVersion: o.metadata.resourceVersion });
  return {
    helm: secrets.map(o => ({ ...metadata(o), version: o.metadata.labels.version, status: o.metadata.labels.status })).sort((a, b) => a.name.localeCompare(b.name)),
    roots: roots.map(o => ({ kind: o.kind, name: o.metadata.name, uid: o.metadata.uid, generation: o.metadata.generation ?? null, specificationSHA256: hash(JSON.stringify(canonical(o.spec))) })).sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name)),
  };
}
const path = '/deployments/' + state.deploymentId;
try {
  const current = (await api('GET', path)).data;
  assert.equal(current.status, 'unknown', 'This acceptance requires an ambiguous release');
  const bindings = (await api('GET', `/apps/${current.appId}/environments`)).data;
  const binding = (bindings.items ?? bindings).find(b => b.id === current.bindingId);
  assert(binding, 'Binding missing');
  const target = binding.target;
  assert(target && /^[0-9a-f-]{36}$/.test(target.clusterId), 'Binding cluster missing');
  for (const key of ['namespace', 'releaseName']) assert(typeof target[key] === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(target[key]), `Invalid target ${key}`);
  if (!state.prepared) {
    state.before = current;
    state.binding = { id: binding.id, version: binding.version, currentDeploymentId: binding.currentDeploymentId };
    state.target = target; state.clusterBefore = clusterEvidence(target);
    state.input = { expectedRevision: current.revision, reason: 'Live acceptance: read-only reconciliation of ambiguous release' };
    state.prepared = true;
    await save();
  }
  assert.deepEqual(target, state.target);
  assert.deepEqual({ id: binding.id, version: binding.version, currentDeploymentId: binding.currentDeploymentId }, state.binding);
  const result = await api('POST', path + '/reconcile', state.input, 200, state.runId + ':reconcile');
  assert.equal(result.data.deploymentId, state.deploymentId);
  assert.equal(result.data.status, 'unknown'); assert.equal(result.data.targetReleased, false);
  assert.equal(result.data.revision, state.before.revision + 1);
  assert(result.data.errorCode && Number.isFinite(Date.parse(result.data.checkedAt)));
  if (state.responseSHA256) assert.equal(result.sha256, state.responseSHA256);
  state.reconciliation = result.data; state.responseSHA256 = result.sha256; await save();
  const replay = await api('POST', path + '/reconcile', state.input, 200, state.runId + ':reconcile');
  assert.equal(replay.sha256, result.sha256, 'Replay bytes changed');
  const changed = await api('POST', path + '/reconcile', { ...state.input, reason: state.input.reason + ' changed' }, 409, state.runId + ':reconcile');
  assert.equal(changed.data.error.code, 'idempotency_conflict');
  const stale = await api('POST', path + '/reconcile', state.input, 409, state.runId + ':stale');
  assert.equal(stale.data.error.code, 'revision_conflict');
  const after = (await api('GET', path)).data;
  assert.equal(after.revision, result.data.revision);
  assert.equal(after.status, 'unknown'); assert.equal(after.finishedAt, null);
  for (const key of ['id', 'requestId', 'appId', 'bindingId', 'artifactId', 'imageRef', 'configVersion', 'kind', 'sourceDeploymentId', 'createdAt', 'startedAt']) assert.deepEqual(after[key], state.before[key], `Frozen ${key} changed`);
  const finalBindings = (await api('GET', `/apps/${current.appId}/environments`)).data;
  const finalBinding = (finalBindings.items ?? finalBindings).find(b => b.id === current.bindingId);
  assert.deepEqual({ id: finalBinding.id, version: finalBinding.version, currentDeploymentId: finalBinding.currentDeploymentId }, state.binding);
  state.clusterAfter = clusterEvidence(state.target);
  assert.deepEqual(state.clusterAfter, state.clusterBefore, 'Helm storage or root specification changed');
  state.after = after;
  state.checks = { byteIdenticalReplay: true, differentInput: '409 idempotency_conflict', staleRevision: '409 revision_conflict', frozenIdentityPreserved: true, successPointerPreserved: true, helmRecordsAndRootSpecificationsUnchanged: true };
  state.passes = (state.passes ?? 0) + 1; state.result = 'passed'; state.completedAt = new Date().toISOString();
  delete state.failure; await save();
  console.log(JSON.stringify({ result: state.result, deploymentId: state.deploymentId, status: after.status, errorCode: after.errorCode, revision: after.revision, passes: state.passes, checks: state.checks }));
} catch (error) {
  state.result = 'failed'; state.failure = { at: new Date().toISOString(), message: error.message };
  await save(); throw error;
}
