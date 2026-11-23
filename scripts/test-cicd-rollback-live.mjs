// Live, resumable rollback acceptance for the podry-demo /version fixture.
// Tokens are process environment only; evidence contains hashes, never Helm Values.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, baseline: { type: 'string' }, upgrade: { type: 'string' },
  output: { type: 'string' }, kubeconfig: { type: 'string' },
  'upgrade-version': { type: 'string', default: 'live-v2' },
  'secret-credential': { type: 'string' }, 'secret-key': { type: 'string' },
  'secret-current-version': { type: 'string' },
  'insecure-kubernetes': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=<token> node scripts/test-cicd-rollback-live.mjs --api http://127.0.0.1:15000 --baseline /outside/baseline.json --upgrade /outside/upgrade.json --kubeconfig docs/k3s.yaml --output /outside/rollback.json [--upgrade-version live-v2] [--insecure-kubernetes]');
  console.log('Requires successful test-cicd-live evidence for two different images in one binding. Verifies the running upgrade, then POSTs rollback from the baseline. Resuming the same output replays the original key. Checks archived Chart/business Values, Pod digest, /version and /ping; does not change application configuration or clean resources. Baseline must predate the /version endpoint.');
  console.log('Optional Secret fixture: --secret-credential UUID --secret-key ENV_NAME --secret-current-version N (N > 2). Requires PODRY_LIVE_SECRET_V1 and PODRY_LIVE_SECRET_V2 in the environment. Checks historical versions 1/2, current configuration reference 2, newer current credential metadata, archived Helm data, live Secret contents and Pod references; never prints or saves values or their hashes.');
  process.exit(0);
}
for (const name of ['api', 'baseline', 'upgrade', 'output', 'kubeconfig']) assert(options[name], `--${name} is required`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const token = process.env.PODRY_LIVE_TOKEN;
assert(token && !/[\r\n]/.test(token), 'PODRY_LIVE_TOKEN is required');
const secretOptions = ['secret-credential', 'secret-key', 'secret-current-version'];
const withSecret = secretOptions.some(name => options[name] !== undefined);
let secretFixture;
if (withSecret) {
  for (const name of secretOptions) assert(options[name], `--${name} is required for Secret verification`);
  assert(uuid.test(options['secret-credential']), 'Invalid Secret credential UUID');
  assert.match(options['secret-key'], /^[A-Za-z_][A-Za-z0-9_]*$/);
  const version = Number(options['secret-current-version']);
  assert(Number.isSafeInteger(version) && version > 2, 'Current credential version must be greater than 2');
  for (const name of ['PODRY_LIVE_SECRET_V1', 'PODRY_LIVE_SECRET_V2']) assert(process.env[name]?.length >= 16, `${name} must contain a random test value`);
  assert(process.env.PODRY_LIVE_SECRET_V1 !== process.env.PODRY_LIVE_SECRET_V2, 'Different test values are required');
  secretFixture = { credentialId: options['secret-credential'], key: options['secret-key'], baselineVersion: 1, upgradeVersion: 2, currentVersion: version };
}
const base = new URL(options.api);
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', '--api must be an exact HTTP(S) origin');
assert(options['upgrade-version'].length <= 100 && !/[\r\n]/.test(options['upgrade-version']), 'Invalid version marker');
const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8'));
const upgrade = JSON.parse(await readFile(resolve(options.upgrade), 'utf8'));
for (const e of [baseline, upgrade]) {
  assert.equal(e.result, 'passed'); assert.equal(e.api, base.origin);
  for (const id of [e.appId, e.bindingId, e.buildId, e.deploymentId, e.artifact?.id]) assert(uuid.test(id), 'Invalid acceptance identity');
  assert.equal(e.deployment.status, 'succeeded'); assert.equal(e.deployment.id, e.deploymentId);
}
assert.equal(upgrade.appId, baseline.appId); assert.equal(upgrade.bindingId, baseline.bindingId);
assert.deepEqual(upgrade.target, baseline.target);
assert.notEqual(upgrade.buildId, baseline.buildId); assert.notEqual(upgrade.commitSha, baseline.commitSha);
assert.notEqual(upgrade.artifact.digest, baseline.artifact.digest, 'A different image digest is required');
assert(upgrade.deployment.helmRevision > baseline.deployment.helmRevision);
const output = resolve(options.output);
assert(![resolve(options.baseline), resolve(options.upgrade)].includes(output), 'Output must not overwrite source evidence');
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
state ??= { schemaVersion: 1, runId: randomUUID(), api: base.origin, appId: baseline.appId, bindingId: baseline.bindingId, baselineId: baseline.deploymentId, upgradeId: upgrade.deploymentId, upgradeVersion: options['upgrade-version'], startedAt: new Date().toISOString(), events: [] };
assert(state.schemaVersion === 1 && state.api === base.origin && state.appId === baseline.appId && state.bindingId === baseline.bindingId && state.baselineId === baseline.deploymentId && state.upgradeId === upgrade.deploymentId && state.upgradeVersion === options['upgrade-version'], 'Evidence belongs to another rollback');
if (state.prepared) assert.deepEqual(state.secretFixture, secretFixture, 'Evidence belongs to another Secret fixture');
if (secretFixture) state.secretFixture = secretFixture;
await mkdir(dirname(output), { recursive: true });
const save = async () => { await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(output + '.tmp', output); };
const event = async (phase, value) => { state.events.push({ at: new Date().toISOString(), phase, value }); console.log(`${phase}: ${value}`); await save(); };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
async function response(url, init = {}) {
  const r = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const chunks = []; let size = 0;
  for await (const b of r.body ?? []) { size += b.length; assert(size <= 4 << 20, 'HTTP response exceeded budget'); chunks.push(b); }
  return { status: r.status, bytes: Buffer.concat(chunks) };
}
async function api(method, path, body, expected = 200, key) {
  const r = await response(new URL('/api' + path, base), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data; try { data = JSON.parse(r.bytes); } catch { throw new Error(`${method} ${path}: non-JSON (${r.status})`); }
  assert.equal(r.status, expected, `${method} ${path}: ${r.status} ${data.error?.code ?? ''}`); return data;
}
const kubeArgs = ['--kubeconfig', resolve(options.kubeconfig), '--request-timeout=25s', ...(options['insecure-kubernetes'] ? ['--insecure-skip-tls-verify=true'] : [])];
function kube(args) {
  const r = spawnSync('kubectl', [...kubeArgs, ...args], { encoding: 'utf8', windowsHide: true, timeout: 35000, maxBuffer: 8 << 20 });
  assert.equal(r.status, 0, 'Kubernetes read failed; inspect cluster access'); return JSON.parse(r.stdout);
}
const target = baseline.target;
function helm(revision, deploymentId, secretVersion) {
  const secret = kube(['-n', target.namespace, 'get', 'secret', `sh.helm.release.v1.${target.releaseName}.v${revision}`, '-o', 'json']);
  const r = JSON.parse(gunzipSync(Buffer.from(Buffer.from(secret.data.release, 'base64').toString(), 'base64'), { maxOutputLength: 8 << 20 }));
  assert.equal(r.version, revision); assert.equal(r.name, target.releaseName); assert.equal(r.namespace, target.namespace);
  assert.equal(r.config.podry.appId, state.appId); assert.equal(r.config.podry.bindingId, state.bindingId); assert.equal(r.config.podry.deploymentId, deploymentId);
  if (secretFixture) {
    assert.deepEqual(r.config.podry.secretKeys, [secretFixture.key]);
    assert.deepEqual(Object.keys(r.config.podry.secretData ?? {}), [secretFixture.key]);
    assert(Buffer.from(r.config.podry.secretData[secretFixture.key], 'base64').equals(Buffer.from(process.env[`PODRY_LIVE_SECRET_V${secretVersion}`])), 'Archived Helm Secret does not match the expected version');
  } else {
    assert.equal(r.config.podry.secretKeys.length, 0, 'Use explicit Secret verification options for business Secrets');
    assert.equal(Object.keys(r.config.podry.secretData ?? {}).length, 0);
  }
  const values = { ...r.config }; delete values.podry;
  return { release: r, values, summary: { revision, chartVersion: r.chart.metadata.version, chartContentsSHA256: hash(canonical(r.chart)), businessValuesSHA256: hash(canonical(values)), replicas: values.replicaCount, environmentNames: Object.keys(values.env ?? {}).sort(), imageRef: r.config.podry.imageRef } };
}
async function http(resource, port, expectedStatus, expectedVersion) {
  const child = spawn('kubectl', [...kubeArgs, '-n', target.namespace, 'port-forward', '--address=127.0.0.1', resource, ':' + port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); exited.catch(() => {});
  try {
    const local = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Port-forward readiness timeout')), 20000); let text = '';
      const reject = () => { clearTimeout(timer); fail(new Error('Port-forward failed')); };
      child.once('error', reject); child.once('exit', reject); child.stderr.resume();
      child.stdout.on('data', b => { text += b.toString(); const match = text.match(/Forwarding from 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); done(Number(match[1])); } });
    });
    const ping = await response(`http://127.0.0.1:${local}/ping`); assert.equal(ping.status, 200); assert.equal(ping.bytes.toString().trim(), 'pong');
    const version = await response(`http://127.0.0.1:${local}/version`); assert.equal(version.status, expectedStatus);
    if (expectedVersion !== undefined) assert.equal(version.bytes.toString().trim(), expectedVersion);
    return { resource, pingStatus: 200, pingBody: 'pong', versionStatus: version.status, ...(expectedVersion === undefined ? {} : { version: expectedVersion }) };
  } finally { child.kill(); await Promise.race([exited, sleep(5000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
async function workload(e, chart, expectedStatus, expectedVersion, secretVersion) {
  const d = kube(['-n', target.namespace, 'get', 'deployment', target.releaseName, '-o', 'json']);
  assert.equal(d.metadata.labels['podry.io/deployment-id'], e.id); assert.equal(d.spec.template.spec.containers[0].image, e.imageRef);
  assert.equal(d.spec.replicas, chart.values.replicaCount);
  assert(d.status.observedGeneration >= d.metadata.generation && d.status.updatedReplicas === d.spec.replicas && d.status.readyReplicas === d.spec.replicas);
  const env = d.spec.template.spec.containers[0].env ?? [];
  assert.deepEqual(Object.fromEntries(env.filter(v => !v.valueFrom).map(v => [v.name, v.value])), chart.values.env ?? {});
  let secretEvidence;
  if (secretFixture) {
    const name = chart.release.config.podry.secretName;
    const reference = { name: secretFixture.key, valueFrom: { secretKeyRef: { name, key: secretFixture.key } } };
    assert.deepEqual(env.filter(v => v.valueFrom), [reference], 'Deployment Secret reference mismatch');
    const secret = kube(['-n', target.namespace, 'get', 'secret', name, '-o', 'json']);
    assert.equal(secret.metadata.labels['podry.io/deployment-id'], e.id); assert.equal(secret.metadata.labels['podry.io/binding-id'], state.bindingId);
    assert.equal(secret.type, 'Opaque'); assert.deepEqual(Object.keys(secret.data), [secretFixture.key]);
    assert(Buffer.from(secret.data[secretFixture.key], 'base64').equals(Buffer.from(process.env[`PODRY_LIVE_SECRET_V${secretVersion}`])), 'Live Secret does not match the expected version');
    secretEvidence = { name, uid: secret.metadata.uid, key: secretFixture.key, version: secretVersion, valueMatched: true };
  } else assert.equal(env.filter(v => v.valueFrom).length, 0);
  const pods = kube(['-n', target.namespace, 'get', 'pods', '-l', `podry.io/binding-id=${state.bindingId}`, '-o', 'json']).items.filter(p => !p.metadata.deletionTimestamp && p.metadata.labels['podry.io/deployment-id'] === e.id);
  assert.equal(pods.length, d.spec.replicas);
  const observed = [];
  for (const p of pods) {
    if (secretFixture) assert.deepEqual((p.spec.containers[0].env ?? []).filter(v => v.valueFrom), env.filter(v => v.valueFrom), 'Pod Secret reference mismatch');
    assert.equal(p.spec.containers[0].image, e.imageRef); assert.equal(p.status.containerStatuses[0].imageID, e.imageRef); assert(p.status.containerStatuses[0].ready);
    observed.push({ name: p.metadata.name, uid: p.metadata.uid, imageID: p.status.containerStatuses[0].imageID, http: await http('pod/' + p.metadata.name, 8080, expectedStatus, expectedVersion) });
  }
  return { uid: d.metadata.uid, replicas: d.spec.replicas, environmentNames: env.map(v => v.name).sort(), ...(secretEvidence ? { secret: secretEvidence } : {}), pods: observed, service: await http('service/' + target.releaseName, 80, expectedStatus, expectedVersion) };
}

try {
  const before = await api('GET', `/deployments/${state.baselineId}`);
  const newer = await api('GET', `/deployments/${state.upgradeId}`);
  assert.equal(before.status, 'succeeded'); assert.equal(newer.status, 'succeeded');
  for (const [actual, expected] of [[before, baseline], [newer, upgrade]]) {
    assert.equal(actual.appId, state.appId); assert.equal(actual.bindingId, state.bindingId); assert.equal(actual.artifactId, expected.artifact.id); assert.equal(actual.imageRef, expected.artifact.imageRef);
  }
  const oldChart = helm(before.helmRevision, before.id, 1); const newChart = helm(newer.helmRevision, newer.id, 2);
  assert.notEqual(oldChart.summary.businessValuesSHA256, newChart.summary.businessValuesSHA256, 'Business configuration must also differ');
  const config = await api('GET', `/apps/${state.appId}/config`);
  async function checkCurrentSecret() {
    const credentials = await api('GET', '/credentials');
    const credential = (credentials.items ?? credentials).find(c => c.id === secretFixture.credentialId);
    assert(credential, 'Secret credential metadata missing');
    assert.equal(credential.kind, 'secret'); assert.equal(credential.version, secretFixture.currentVersion);
    const current = await api('GET', `/apps/${state.appId}/config`);
    assert.deepEqual(current.secretRefs, [{ credentialId: secretFixture.credentialId, version: 2, targetKey: secretFixture.key }]);
    return { credentialId: credential.id, version: credential.version, configSecretVersion: 2 };
  }
  if (secretFixture) state.currentSecretCredential = await checkCurrentSecret();
  const bindings = await api('GET', `/apps/${state.appId}/environments`);
  const binding = (bindings.items ?? bindings).find(b => b.id === state.bindingId); assert(binding);
  // Once the preflight is persisted, retries may replay a request whose response was lost.
  if (!state.prepared) {
    assert.equal(binding.currentDeploymentId, newer.id, 'Upgrade must be current before the first rollback');
    state.upgradeWorkload = await workload(newer, newChart, 200, state.upgradeVersion, 2);
    state.baseline = { deployment: before, chart: oldChart.summary, commitSha: baseline.commitSha, buildId: baseline.buildId };
    state.upgrade = { deployment: newer, chart: newChart.summary, commitSha: upgrade.commitSha, buildId: upgrade.buildId };
    state.currentConfig = { version: config.version, sha256: hash(canonical(config)), bindingVersion: binding.version, overrideSHA256: hash(canonical(binding.overrideValues)), autoDeploy: binding.autoDeploy };
    state.prepared = true; await event('upgrade', 'different image and business configuration verified');
  }
  assert.equal(hash(canonical(config)), state.currentConfig.sha256, 'Current source configuration changed');
  const request = await api('POST', `/deployments/${before.id}/rollback`, { reason: 'Live acceptance: restore the previous image and complete historical business configuration' }, 202, state.runId + ':rollback');
  assert.equal(request.kind, 'rollback'); assert.equal(request.bindingId, state.bindingId); assert(uuid.test(request.deploymentId));
  assert(!state.requestId || state.requestId === request.requestId); assert(!state.deploymentId || state.deploymentId === request.deploymentId);
  state.requestId = request.requestId; state.deploymentId = request.deploymentId; await save();
  const deadline = Date.now() + 900000; let previous;
  while (Date.now() < deadline) {
    const d = await api('GET', `/deployments/${state.deploymentId}`); state.deployment = d;
    assert.equal(d.kind, 'rollback'); assert.equal(d.sourceDeploymentId, before.id); assert.equal(d.artifactId, before.artifactId); assert.equal(d.imageRef, before.imageRef); assert.equal(d.configVersion, before.configVersion);
    if (d.status !== previous) { previous = d.status; await event('rollback', d.status); }
    assert(!['failed', 'canceled'].includes(d.status), `Rollback failed (${d.errorCode})`);
    if (d.status === 'succeeded') break;
    // Unknown only triggers observation by the backend; never another release request.
    await sleep(3000);
  }
  assert.equal(state.deployment.status, 'succeeded', 'Rollback timed out; preserve output and resume');
  assert(state.deployment.helmRevision > newer.helmRevision);
  const restored = helm(state.deployment.helmRevision, state.deploymentId, 1);
  assert.equal(restored.release.info.status, 'deployed');
  assert.deepEqual(restored.values, oldChart.values, 'Rollback did not restore complete historical business Values');
  assert.deepEqual(restored.release.chart, oldChart.release.chart, 'Rollback did not reuse historical Chart contents');
  assert.equal(restored.summary.imageRef, before.imageRef);
  state.restoredChart = restored.summary;
  state.restoredWorkload = await workload(state.deployment, restored, 404, undefined, 1);
  assert.equal(await api('GET', `/apps/${state.appId}/config`).then(c => hash(canonical(c))), state.currentConfig.sha256);
  if (secretFixture) {
    assert.deepEqual(await checkCurrentSecret(), state.currentSecretCredential);
    assert.notEqual(state.restoredWorkload.secret.name, state.upgradeWorkload.secret.name, 'Rollback must create a new execution Secret');
    assert.notEqual(state.restoredWorkload.secret.uid, state.upgradeWorkload.secret.uid);
  }
  const finalBindings = await api('GET', `/apps/${state.appId}/environments`);
  const final = (finalBindings.items ?? finalBindings).find(b => b.id === state.bindingId);
  assert.equal(final.currentDeploymentId, state.deploymentId); assert.equal(final.version, state.currentConfig.bindingVersion);
  assert.equal(hash(canonical(final.overrideValues)), state.currentConfig.overrideSHA256); assert.equal(final.autoDeploy, state.currentConfig.autoDeploy);
  state.finalBinding = { id: final.id, version: final.version, currentDeploymentId: final.currentDeploymentId, autoDeploy: final.autoDeploy };
  state.result = 'passed'; state.passes = (state.passes ?? 0) + 1; state.finishedAt = new Date().toISOString(); delete state.error;
  await event('acceptance', 'passed');
} catch (error) { state.result = 'failed'; state.error = error.message; await save(); console.error(error.message); process.exitCode = 1; }
