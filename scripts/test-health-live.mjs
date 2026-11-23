// Explicit read-only acceptance for the existing opt-in health worker.
// This script never starts workers or reads the resources endpoint: an operator
// must enable polling separately. SQL is limited to metadata in a test database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, app: { type: 'string' }, binding: { type: 'string' },
  'database-container': { type: 'string' }, output: { type: 'string' },
  refreshes: { type: 'string', default: '2' },
  'timeout-seconds': { type: 'string', default: '240' },
  help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=<token> node scripts/test-health-live.mjs --api http://127.0.0.1:15000 --app UUID --binding UUID --database-container TEST_POSTGRES_CONTAINER --output /outside/health.json [--refreshes 2] [--timeout-seconds 240]');
  console.log('Requires an independently enabled health worker and a healthy single-binding test application. Uses only app detail/list GETs and read-only PostgreSQL metadata queries through docker exec. Requires POSTGRES_USER and POSTGRES_DB in that container. Verifies fresh repeated observations, completed poll leases, identity, API projections and unchanged delivery counts. Reusing the same output preserves samples; never deploys, changes grants, or enables workers.');
  process.exit(0);
}
for (const name of ['api', 'app', 'binding', 'database-container', 'output']) assert(options[name], `--${name} is required`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuid.test(options.app) && uuid.test(options.binding), 'Application and binding must be UUIDs');
assert.match(options['database-container'], /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
const refreshes = Number(options.refreshes), timeout = Number(options['timeout-seconds']);
assert(Number.isInteger(refreshes) && refreshes >= 2 && refreshes <= 5, 'Refreshes must be 2..5');
assert(Number.isInteger(timeout) && timeout >= 60 && timeout <= 900, 'Timeout must be 60..900 seconds');
const token = process.env.PODRY_LIVE_TOKEN;
assert(token && !/[\r\n]/.test(token), 'PODRY_LIVE_TOKEN is required');
const base = new URL(options.api);
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', '--api must be an exact HTTP(S) origin');
const output = resolve(options.output);
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
state ??= { schemaVersion: 1, runId: randomUUID(), api: base.origin, appId: options.app, bindingId: options.binding, databaseContainer: options['database-container'], requiredRefreshes: refreshes, samples: [], startedAt: new Date().toISOString() };
assert(state.schemaVersion === 1 && state.api === base.origin && state.appId === options.app && state.bindingId === options.binding && state.databaseContainer === options['database-container'] && state.requiredRefreshes === refreshes, 'Output belongs to another acceptance run');
await mkdir(dirname(output), { recursive: true });
async function save() { await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); await rename(output + '.tmp', output); }
async function api(path) {
  const r = await fetch(new URL('/api' + path, base), { redirect: 'manual', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  assert.equal(r.status, 200, 'Health summary API read failed');
  const bytes = Buffer.from(await r.arrayBuffer()); assert(bytes.length <= 1 << 20, 'API response exceeded budget');
  return JSON.parse(bytes);
}
async function verifySummary() {
  const detail = await api(`/apps/${state.appId}`);
  const page = await api('/apps?health=healthy&page=1&pageSize=100');
  assert.equal(detail.id, state.appId); assert.equal(detail.health, 'healthy');
  assert(page.items?.some(a => a.id === state.appId && a.health === 'healthy'), 'Healthy filter omitted the application');
}
function metadata() {
  // UUIDs were validated above. No caller-supplied SQL, passwords or resource
  // manifests enter this boundary; PostgreSQL also enforces read-only mode.
  const sql = `SELECT json_build_object(
    'clock',clock_timestamp(),
    'binding',(SELECT json_build_object('appId',b.app_id,'version',b.version,'currentDeploymentId',b.current_deployment_id) FROM app_environment_bindings b WHERE b.id='${state.bindingId}'),
    'bindingCount',(SELECT count(*) FROM app_environment_bindings WHERE app_id='${state.appId}'),
    'poll',(SELECT json_build_object('startedAt',p.started_at,'nextPollAt',p.next_poll_at,'leased',p.lease_token IS NOT NULL,'errorCode',p.last_error_code) FROM binding_health_polls p WHERE p.binding_id='${state.bindingId}'),
    'observation',(SELECT json_build_object('bindingVersion',o.binding_version,'deploymentId',o.deployment_id,'deploymentRevision',o.deployment_revision,'credentialId',o.credential_id,'credentialVersion',o.credential_version,'health',o.health,'observedAt',o.observed_at,'ageSeconds',extract(epoch FROM clock_timestamp()-o.observed_at)) FROM binding_observations o WHERE o.binding_id='${state.bindingId}'),
    'projectedHealth',(SELECT health FROM application_health WHERE app_id='${state.appId}'),
    'counts',json_build_object('builds',(SELECT count(*) FROM builds),'attempts',(SELECT count(*) FROM build_attempts),'artifacts',(SELECT count(*) FROM artifacts),'intents',(SELECT count(*) FROM auto_deploy_intents),'previews',(SELECT count(*) FROM deployment_previews),'snapshots',(SELECT count(*) FROM release_snapshots),'requests',(SELECT count(*) FROM release_requests),'deployments',(SELECT count(*) FROM deployments))
  );`;
  const r = spawnSync('docker', ['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', state.databaseContainer, 'sh', '-c', 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt -v ON_ERROR_STOP=1 -c "$1"', 'sh', sql], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1 << 20 });
  assert.equal(r.status, 0, 'Read-only health metadata query failed');
  return JSON.parse(r.stdout);
}
try {
  const first = metadata();
  assert.equal(first.binding?.appId, state.appId, 'Binding belongs to another application');
  assert.equal(first.bindingCount, 1, 'This fixture requires exactly one application binding');
  assert(first.poll, 'Binding has no persisted health schedule');
  assert(uuid.test(first.binding.currentDeploymentId), 'Binding needs a successful current deployment');
  state.baseline ??= first;
  assert.deepEqual(first.binding, state.baseline.binding, 'Binding or successful deployment changed');
  assert.deepEqual(first.counts, state.baseline.counts, 'Delivery tasks changed since this run started');
  state.result = 'running'; delete state.error;
  await save();
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const sample = metadata();
    assert.deepEqual(sample.binding, state.baseline.binding, 'Binding or successful deployment changed');
    assert.deepEqual(sample.counts, state.baseline.counts, 'Health polling created or changed delivery task counts');
    const o = sample.observation, p = sample.poll;
    const already = o && state.samples.some(s => s.observation.observedAt === o.observedAt);
    if (state.samples.length < refreshes && o?.health === 'healthy' && !already && o.ageSeconds >= 0 && o.ageSeconds < 60 &&
      Date.parse(o.observedAt) > Date.parse(state.baseline.clock) && !p.leased && p.errorCode === null &&
      Date.parse(o.observedAt) >= Date.parse(p.startedAt) && Date.parse(p.nextPollAt) > Date.parse(p.startedAt)) {
      assert.equal(o.bindingVersion, sample.binding.version);
      assert.equal(o.deploymentId, sample.binding.currentDeploymentId);
      assert.equal(sample.projectedHealth, 'healthy');
      await verifySummary();
      if (state.samples.length) {
        const prior = state.samples.at(-1).observation;
        assert(Date.parse(o.observedAt) > Date.parse(prior.observedAt), 'Observation timestamp did not advance');
        for (const key of ['deploymentId', 'deploymentRevision', 'credentialId', 'credentialVersion']) assert.equal(o[key], prior[key], 'Observation identity changed');
      }
      state.samples.push({ ...sample, apiDetailHealth: 'healthy', apiListHealthy: true });
      console.log(`health: fresh completed background observation ${state.samples.length}/${refreshes}`);
      await save();
    }
    if (state.samples.length >= refreshes && o?.health === 'healthy' && o.ageSeconds >= 0 && o.ageSeconds < 60 && sample.projectedHealth === 'healthy') {
      // Resume must verify the current projection too; old successful samples
      // alone cannot prove that the worker is still refreshing this binding.
      assert.equal(o.bindingVersion, sample.binding.version);
      assert.equal(o.deploymentId, sample.binding.currentDeploymentId);
      for (const key of ['deploymentId', 'deploymentRevision', 'credentialId', 'credentialVersion']) assert.equal(o[key], state.samples.at(-1).observation[key], 'Current observation identity changed');
      await verifySummary();
      state.current = { ...sample, apiDetailHealth: 'healthy', apiListHealthy: true };
      state.result = 'passed'; state.passes = (state.passes ?? 0) + 1; state.finishedAt = new Date().toISOString(); delete state.error;
      await save(); console.log('health acceptance: passed'); break;
    }
    await new Promise(done => setTimeout(done, 5000));
  }
  assert.equal(state.result, 'passed', 'Repeated background health observations timed out; preserve output and resume');
} catch (e) {
  state.result = 'failed'; state.error = e.message;
  await save(); console.error(e.message); process.exitCode = 1;
}
