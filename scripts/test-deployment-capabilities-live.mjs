// Mutates only explicitly selected acceptance apps/binding. Provision isolated
// backend/namespace, borrowed mounts and an authenticated Registry beforehand.
// Credentials come from environment; evidence contains no raw logs or Secrets.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, app: { type: 'string' }, binding: { type: 'string' },
  'failure-app': { type: 'string' }, 'build-namespace': { type: 'string' },
  registry: { type: 'string' }, output: { type: 'string' }, kubeconfig: { type: 'string' },
  'insecure-kubernetes': { type: 'boolean', default: false },
  'timeout-seconds': { type: 'string', default: '1200' }, help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=... PODRY_LIVE_REGISTRY_AUTHORITY=... PODRY_LIVE_REGISTRY_USERNAME=... PODRY_LIVE_REGISTRY_PASSWORD=... node scripts/test-deployment-capabilities-live.mjs --api http://127.0.0.1:15001 --app UUID --failure-app UUID --binding UUID --registry UUID --build-namespace CI_NAMESPACE --kubeconfig docs/k3s.yaml --output /outside-repo/evidence.json [--insecure-kubernetes]');
  console.log('Requires dedicated apps: successful shell check + Chart 1.2.0 Deployment with three probes, configFiles and existing ConfigMap/Secret/PVC mounts; a separate check that exits 23; and a Registry that rejects anonymous reads. Runs real CI, deploys, offlines, imports the same private image, reinstalls, offlines again and detaches. Retains borrowed resources and all history. Same output resumes frozen requests; unknown never creates another submission.');
  process.exit(0);
}
for (const k of ['api', 'app', 'failure-app', 'binding', 'registry', 'build-namespace', 'output', 'kubeconfig']) assert(options[k], `--${k} is required`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
for (const k of ['app', 'failure-app', 'binding', 'registry']) assert.match(options[k], uuid);
assert.notEqual(options.app, options['failure-app']);
const base = new URL(options.api), token = process.env.PODRY_LIVE_TOKEN;
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'API must be an exact HTTP(S) origin');
assert(token && !/[\r\n]/.test(token), 'PODRY_LIVE_TOKEN is required');
const timeout = Number(options['timeout-seconds']);
assert(Number.isInteger(timeout) && timeout >= 60 && timeout <= 7200);
const output = resolve(options.output), baselineOutput = output + '.baseline.json';
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const identity = { schemaVersion: 1, api: base.origin, appId: options.app, failureAppId: options['failure-app'], bindingId: options.binding, registryId: options.registry, buildNamespace: options['build-namespace'] };
state ??= { ...identity, runId: randomUUID(), startedAt: new Date().toISOString(), operations: {}, events: [] };
for (const [k, v] of Object.entries(identity)) assert.equal(state[k], v, 'Evidence identity changed: ' + k);
await mkdir(dirname(output), { recursive: true });
const save = async () => { await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(output + '.tmp', output); };
const event = async (phase, value) => { state.events.push({ at: new Date().toISOString(), phase, value }); console.log(`${phase}: ${value}`); await save(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = b => createHash('sha256').update(b).digest('hex');
async function api(method, path, body, status = 200, key) {
  const r = await fetch(new URL('/api' + path, base), { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const text = await r.text(); let data;
  try { data = JSON.parse(text); } catch { throw Error(`${method} ${path}: non-JSON HTTP ${r.status}`); }
  assert.equal(r.status, status, `${method} ${path}: HTTP ${r.status} ${data.error?.code ?? ''}`);
  return data;
}
// Save inputs/keys before dispatch; a crash or lost response reuses that key.
async function mutation(name, path, prepare, status = 202) {
  let op = state.operations[name];
  if (!op) { op = state.operations[name] = { path, key: state.runId + ':' + name, input: await prepare() }; await save(); }
  assert.equal(op.path, path);
  const value = await api('POST', path, op.input, status, op.key);
  if (op.result) assert.deepEqual(value, op.result, 'Idempotency replay changed: ' + name);
  op.result = value; await save(); return value;
}
async function poll(name, get, expected = 'succeeded') {
  let previous; const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const value = await get();
    if (value.status !== previous) { previous = value.status; await event(name, value.status); }
    if (value.status === expected) return value;
    assert(!['succeeded', 'failed', 'canceled', 'cancelled'].includes(value.status), `${name} unexpected terminal status ${value.status} (${value.errorCode ?? ''})`);
    await sleep(3000);
  }
  throw Error(name + ' timed out; retain evidence and resume with the same output');
}
const kubeArgs = ['--kubeconfig', resolve(options.kubeconfig), '--request-timeout=25s', ...(options['insecure-kubernetes'] ? ['--insecure-skip-tls-verify=true'] : [])];
function kube(args, input) {
  const r = spawnSync('kubectl', [...kubeArgs, ...args], { input, encoding: 'utf8', windowsHide: true, timeout: 35000, maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, 'kubectl read failed; inspect acceptance cluster');
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const bindings = () => api('GET', `/apps/${state.appId}/environments`);
const binding = async () => { const b = (await bindings()).find(b => b.id === state.bindingId); assert(b, 'Active binding missing'); return b; };
async function offline(name) {
  const path = `/apps/${state.appId}/environments/${state.bindingId}/offline`;
  const request = await mutation(name, path, async () => ({ expectedVersion: (await binding()).version, reason: 'Dedicated capabilities acceptance: ' + name }));
  assert.equal(request.kind, 'offline');
  const d = await poll(name, () => api('GET', `/deployments/${request.deploymentId}`));
  assert.equal((await binding()).currentDeploymentId, null);
  const workflow = await api('GET', `/apps/${state.appId}/pipelines`);
  assert(workflow.items.filter(p => p.bindingId === state.bindingId).every(p => !p.enabled));
  const objects = kube(['-n', state.target.namespace, 'get', 'deployment,service,ingress,configmap,secret,pods', '-l', 'podry.io/binding-id=' + state.bindingId, '-o', 'json']);
  assert.equal(objects.items.length, 0, 'Offline left managed objects or Pods');
  const helm = helmHistory(); assert.equal(helm.at(-1).status, 'uninstalled');
  const app = await api('GET', `/apps/${state.appId}`); assert.equal(app.health, 'stopped');
  await mutation(name, path, () => assert.fail('Stored offline input missing'));
  await verifyBorrowed();
  return { deployment: d, managedObjectCount: 0, helm, bindingCurrentDeploymentId: null, health: app.health, replayVerified: true };
}
function helmHistory() {
  const list = kube(['-n', state.target.namespace, 'get', 'secret', '-l', 'owner=helm,name=' + state.target.releaseName, '-o', 'json']);
  return list.items.map(secret => {
    const release = JSON.parse(gunzipSync(Buffer.from(Buffer.from(secret.data.release, 'base64').toString(), 'base64')));
    return { revision: release.version, status: release.info.status, chartVersion: release.chart.metadata.version };
  }).sort((a, b) => a.revision - b.revision);
}
async function verifyBorrowed() {
  for (const ref of state.borrowed) {
    const obj = kube(['-n', state.target.namespace, 'get', ref.kind, ref.name, '-o', 'json']);
    assert.equal(obj.metadata.uid, ref.uid, 'Borrowed resource identity changed');
    if (ref.kind === 'persistentvolumeclaim') assert.equal(obj.status.phase, 'Bound');
  }
}
function inspectWorkload(deployment) {
  const d = kube(['-n', state.target.namespace, 'get', 'deployment', state.target.releaseName, '-o', 'json']);
  const spec = d.spec.template.spec, c = spec.containers[0];
  assert.equal(d.metadata.labels['podry.io/deployment-id'], deployment.id);
  assert.equal(c.image, deployment.imageRef); assert.equal(d.status.readyReplicas, d.spec.replicas);
  for (const key of ['readinessProbe', 'livenessProbe', 'startupProbe']) assert(c[key], 'Probe missing: ' + key);
  assert.equal(spec.imagePullSecrets.length, 1);
  const pull = kube(['-n', state.target.namespace, 'get', 'secret', spec.imagePullSecrets[0].name, '-o', 'json']);
  assert.equal(pull.type, 'kubernetes.io/dockerconfigjson');
  const auth = JSON.parse(Buffer.from(pull.data['.dockerconfigjson'], 'base64'));
  assert(auth.auths[process.env.PODRY_LIVE_REGISTRY_AUTHORITY], 'Expected private Registry authority');
  const generated = spec.volumes.find(v => v.name === 'podry-config'); assert(generated);
  const cm = kube(['-n', state.target.namespace, 'get', 'configmap', generated.configMap.name, '-o', 'json']);
  assert.deepEqual(cm.data, state.configFiles);
  for (const volume of state.mounts) {
    const actual = spec.volumes.find(v => v.name === volume.name); assert(actual);
    const type = volume.configMap ? 'configMap' : volume.secret ? 'secret' : 'persistentVolumeClaim';
    // Kubernetes adds defaultMode to ConfigMap/Secret volume sources.
    for (const [key, value] of Object.entries(volume[type])) assert.deepEqual(actual[type][key], value);
    assert(c.volumeMounts.some(m => m.name === volume.name && m.mountPath === volume.mountPath && (m.readOnly ?? false) === volume.readOnly));
  }
  const pods = kube(['-n', state.target.namespace, 'get', 'pods', '-l', 'podry.io/deployment-id=' + deployment.id, '-o', 'json']).items;
  assert.equal(pods.length, d.spec.replicas);
  for (const p of pods) assert(p.status.containerStatuses[0].ready && p.status.containerStatuses[0].imageID === deployment.imageRef);
  return { uid: d.metadata.uid, pullSecret: { name: pull.metadata.name, uid: pull.metadata.uid, type: pull.type }, generatedConfig: { name: cm.metadata.name, uid: cm.metadata.uid }, probes: ['readinessProbe', 'livenessProbe', 'startupProbe'], mounts: c.volumeMounts, pods: pods.map(p => ({ name: p.metadata.name, uid: p.metadata.uid, imageID: p.status.containerStatuses[0].imageID, ready: true })) };
}
async function verifyAnonymousPullRejected() {
  const ns = state.target.namespace, name = 'podry-anonymous-' + state.runId.slice(0, 8);
  let pod = kube(['-n', ns, 'get', 'pod', name, '--ignore-not-found', '-o', 'json']);
  if (!pod) pod = kube(['create', '-f', '-', '-o', 'json'], JSON.stringify({ apiVersion: 'v1', kind: 'Pod', metadata: { namespace: ns, name, labels: { 'podry.io/acceptance-run': state.runId } }, spec: { automountServiceAccountToken: false, restartPolicy: 'Never', containers: [{ name: 'app', image: state.baseline.artifact.imageRef, imagePullPolicy: 'Always', resources: { requests: { cpu: '10m', memory: '16Mi' }, limits: { cpu: '100m', memory: '64Mi' } } }] } }));
  assert.equal(pod.metadata.labels['podry.io/acceptance-run'], state.runId);
  assert.equal(pod.spec.containers[0].image, state.baseline.artifact.imageRef);
  assert(!pod.spec.imagePullSecrets?.length, 'Negative control inherited pull credentials');
  let verified = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const events = kube(['-n', ns, 'get', 'events', '--field-selector', 'involvedObject.uid=' + pod.metadata.uid, '-o', 'json']);
    if (events.items.some(e => e.reason === 'Failed' && /401|unauthorized|authorization failed.*no basic auth credentials/i.test(e.message ?? ''))) { verified = true; break; }
    const current = kube(['-n', ns, 'get', 'pod', name, '-o', 'json']); assert.equal(current.metadata.uid, pod.metadata.uid);
    assert(!current.status.containerStatuses?.some(c => c.state.running || c.state.terminated?.exitCode === 0), 'Anonymous control unexpectedly ran');
    await sleep(2000);
  }
  assert(verified, 'Kubelet did not confirm unauthorized anonymous image pull');
  kube(['delete', '--raw', `/api/v1/namespaces/${ns}/pods/${name}`, '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', gracePeriodSeconds: 0, preconditions: { uid: pod.metadata.uid } }));
  return { podUid: pod.metadata.uid, imageRef: state.baseline.artifact.imageRef, imagePullPolicy: 'Always', imagePullSecrets: [], unauthorized: true, removedWithUIDPrecondition: true };
}
try {
  if (!state.prepared) {
    const b = await binding(), c = await api('GET', `/apps/${state.appId}/config`);
    assert.equal(c.chartConfig?.chartVersion, '1.2.0'); assert(c.buildConfig?.checkScript);
    assert.equal(b.autoDeploy, false); assert.equal(b.currentDeploymentId, null, 'Use a fresh dedicated binding');
    for (const key of ['readinessProbe', 'livenessProbe', 'startupProbe']) assert(c.deployValues[key]);
    state.target = b.target; state.configFiles = c.deployValues.configFiles; state.mounts = c.deployValues.volumes;
    assert(Object.keys(state.configFiles).length && state.mounts.some(v => v.configMap) && state.mounts.some(v => v.secret) && state.mounts.some(v => v.persistentVolumeClaim));
    state.borrowed = state.mounts.map(v => {
      const kind = v.configMap ? 'configmap' : v.secret ? 'secret' : 'persistentvolumeclaim';
      const name = v.configMap?.name ?? v.secret?.secretName ?? v.persistentVolumeClaim?.claimName;
      return { kind, name, uid: kube(['-n', state.target.namespace, 'get', kind, name, '-o', 'json']).metadata.uid };
    });
    state.prepared = true; await save();
  }
  if (!state.failure) {
    const build = await mutation('check-failure', `/apps/${state.failureAppId}/builds`, async () => {
      const c = await api('GET', `/apps/${state.failureAppId}/config`); assert(c.buildConfig?.checkScript);
      const commits = await api('GET', `/apps/${state.failureAppId}/git/commits?ref=${encodeURIComponent(c.gitConfig.branch)}&limit=1`);
      return { commitSha: commits.resolvedRef, expectedConfigVersion: c.version };
    });
    const failed = await poll('check-failure', () => api('GET', `/builds/${build.id}`), 'failed');
    assert.equal(failed.artifactId, null);
    const attempts = await api('GET', `/builds/${build.id}/attempts`); assert.equal(attempts.length, 1);
    const a = attempts[0], pods = kube(['-n', state.buildNamespace, 'get', 'pods', '-l', 'batch.kubernetes.io/controller-uid=' + a.jobUid, '-o', 'json']).items;
    assert.equal(pods.length, 1); const pod = pods[0];
    assert.equal(pod.status.initContainerStatuses.find(c => c.name === 'source').state.terminated.exitCode, 0);
    // The controlled runner normalizes failed subprocesses to exit 1.
    assert.equal(pod.status.initContainerStatuses.find(c => c.name === 'check').state.terminated.exitCode, 1);
    assert(!pod.status.containerStatuses.some(c => c.started || c.state.running || c.state.terminated?.exitCode === 0));
    assert.equal((await api('GET', `/apps/${state.failureAppId}/artifacts`)).total, 0);
    const logs = await fetch(new URL(`/api/builds/${build.id}/logs?attemptNo=1&follow=false`, base), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    assert.equal(logs.status, 200); const raw = await logs.text(), frames = raw.trim().split('\n').map(line => JSON.parse(line));
    assert(frames.some(f => f.type === 'log' && f.phase === 'check') && frames.at(-1).type === 'end' && !frames.some(f => f.type === 'error'));
    state.failure = { build: failed, attemptId: a.id, jobUid: a.jobUid, podUid: pod.metadata.uid, runnerExitCode: 1, artifactCount: 0, logs: { sha256: hash(raw), phases: [...new Set(frames.filter(f => f.type === 'log').map(f => f.phase))] } }; await save();
  }
  if (!state.baseline?.workload) {
    const args = [fileURLToPath(new URL('./test-cicd-live.mjs', import.meta.url)), '--api', base.origin, '--app', state.appId, '--binding', state.bindingId, '--build-namespace', state.buildNamespace, '--kubeconfig', resolve(options.kubeconfig), '--output', baselineOutput, '--timeout-seconds', String(timeout), '--private-registry', ...(options['insecure-kubernetes'] ? ['--insecure-kubernetes'] : [])];
    const child = spawn(process.execPath, [...process.execArgv.filter(a => a === '--use-system-ca'), ...args], { windowsHide: true, stdio: 'inherit' });
    await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(Error('Baseline CI/CD acceptance failed; resume with same output'))); });
    const baseline = JSON.parse(await readFile(baselineOutput, 'utf8')); assert.equal(baseline.result, 'passed'); assert(baseline.check);
    state.baseline = { buildId: baseline.buildId, artifact: baseline.artifact, deployment: baseline.deployment, registry: baseline.registry, check: baseline.check, logs: baseline.logs, http: baseline.http }; state.baseline.workload = inspectWorkload(baseline.deployment); await verifyBorrowed(); await save();
  }
  if (!state.anonymousPull) { state.anonymousPull = await verifyAnonymousPullRejected(); await save(); await event('private-pull', 'anonymous kubelet pull rejected; managed Pod Ready'); }
  if (!state.firstOffline) { state.firstOffline = await offline('first-offline'); await save(); }
  if (!state.externalArtifact) {
    state.externalArtifact = await mutation('import-image', `/apps/${state.appId}/artifacts`, () => ({ imageRef: state.baseline.artifact.imageRef, registryId: state.registryId }), 201);
    assert.equal(state.externalArtifact.source, 'external'); await save();
  }
  if (!state.reenabled) {
    const w = await api('GET', `/apps/${state.appId}/pipelines`);
    const items = w.items.map(p => ({ id: p.id, kind: p.kind, bindingId: p.bindingId, enabled: p.bindingId === state.bindingId ? true : p.enabled, definition: p.definition }));
    if (w.items.some(p => p.bindingId === state.bindingId && !p.enabled)) await api('PUT', `/apps/${state.appId}/pipelines`, { expectedVersion: w.version, items });
    state.reenabled = true; await save();
  }
  if (!state.reinstalled) {
    if (!state.previewId) {
      const c = await api('GET', `/apps/${state.appId}/config`);
      const preview = await api('POST', `/apps/${state.appId}/deployment-previews`, { bindingId: state.bindingId, artifactId: state.externalArtifact.id, expectedConfigVersion: c.version }, 201);
      state.previewId = preview.previewId; await save();
    }
    const r = await mutation('reinstall', `/apps/${state.appId}/deployments`, () => ({ previewId: state.previewId }));
    const deployment = await poll('reinstall', () => api('GET', `/deployments/${r.deploymentId}`));
    assert.equal(deployment.artifactId, state.externalArtifact.id); assert(deployment.helmRevision > state.baseline.deployment.helmRevision);
    assert.equal((await binding()).currentDeploymentId, deployment.id);
    state.reinstalled = { deployment, workload: inspectWorkload(deployment), helm: helmHistory() }; await save();
  }
  if (!state.finalOffline) { state.finalOffline = await offline('final-offline'); await save(); }
  state.detach = await mutation('detach', `/apps/${state.appId}/environments/${state.bindingId}/detach`, async () => ({ expectedVersion: (await binding()).version, reason: 'Capabilities verified; retain history and borrowed resources' }), 200);
  assert.equal(state.detach.detached, true); assert(!(await bindings()).some(b => b.id === state.bindingId));
  assert(!(await api('GET', `/apps/${state.appId}/pipelines`)).items.some(p => p.bindingId === state.bindingId));
  for (const d of [state.baseline.deployment, state.firstOffline.deployment, state.reinstalled.deployment, state.finalOffline.deployment]) assert.equal((await api('GET', `/deployments/${d.id}`)).status, 'succeeded');
  await verifyBorrowed();
  state.result = 'passed'; state.finishedAt = new Date().toISOString(); delete state.error; await event('capabilities', 'passed');
} catch (error) {
  state.result = 'failed'; state.error = error.message; await save(); console.error(error.message); process.exitCode = 1;
}
