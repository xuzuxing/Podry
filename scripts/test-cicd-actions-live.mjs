// Dedicated live acceptance: cancel a running build, retry frozen inputs, then
// execute and roll back a finite Helm Job. All mutation keys survive restarts.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, app: { type: 'string' }, binding: { type: 'string' },
  output: { type: 'string' }, kubeconfig: { type: 'string' },
  'timeout-seconds': { type: 'string', default: '1200' },
  'insecure-kubernetes': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=<token> node scripts/test-cicd-actions-live.mjs --api http://127.0.0.1:15000 --app UUID --binding UUID --kubeconfig docs/k3s.yaml --output /outside-repo/actions.json [--insecure-kubernetes]');
  console.log('Requires a dedicated manual Job application using Dockerfile.job and BUILD_HOLD_SECONDS=30..300, anonymous HTTPS Registry, and CI/CD in the same namespace. Creates one Build with two Attempts and two Helm releases (deploy + historical rollback). Reuse --output to resume; no resource cleanup. Use Node --use-system-ca or NODE_EXTRA_CA_CERTS for private CAs.');
  process.exit(0);
}
for (const name of ['api', 'app', 'binding', 'output', 'kubeconfig']) assert(options[name], `--${name} is required`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuid.test(options.app) && uuid.test(options.binding), 'Application and binding must be UUIDs');
const token = process.env.PODRY_LIVE_TOKEN;
assert(token && !/[\r\n]/.test(token), 'PODRY_LIVE_TOKEN is required');
const base = new URL(options.api);
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', '--api must be an exact HTTP(S) origin');
const timeout = Number(options['timeout-seconds']);
assert(Number.isInteger(timeout) && timeout >= 60 && timeout <= 7200, 'Timeout must be 60..7200 seconds');
const output = resolve(options.output);
let state;
try { state = JSON.parse(await readFile(output, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
state ??= { schemaVersion: 1, runId: randomUUID(), api: base.origin, appId: options.app, bindingId: options.binding, startedAt: new Date().toISOString(), events: [] };
assert(state.schemaVersion === 1 && state.api === base.origin && state.appId === options.app && state.bindingId === options.binding, 'Evidence belongs to another application or API');
await mkdir(dirname(output), { recursive: true });
const save = async () => {
  await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(output + '.tmp', output);
};
const event = async (phase, value) => {
  state.events.push({ at: new Date().toISOString(), phase, value });
  console.log(`${phase}: ${value}`); await save();
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function response(url, init = {}, limit = 8 << 20) {
  const r = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const chunks = []; let size = 0;
  for await (const chunk of r.body ?? []) {
    size += chunk.length; assert(size <= limit, 'HTTP response exceeded acceptance budget'); chunks.push(chunk);
  }
  return { status: r.status, bytes: Buffer.concat(chunks) };
}
async function api(method, path, body, status = 200, key) {
  const r = await response(new URL('/api' + path, base), { method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = JSON.parse(r.bytes); } catch { throw new Error(`${method} ${path}: non-JSON response (${r.status})`); }
  assert.equal(r.status, status, `${method} ${path}: HTTP ${r.status}, ${data.error?.code ?? 'unexpected_status'}`);
  return data;
}
async function wait(phase, get, done, rejected = ['failed', 'canceled', 'succeeded']) {
  const deadline = Date.now() + timeout * 1000; let previous;
  while (Date.now() < deadline) {
    const value = await get();
    if (value.status !== previous) { previous = value.status; await event(phase, value.status ?? 'waiting'); }
    if (await done(value)) return value;
    assert(!rejected.includes(value.status), `${phase}: unexpected ${value.status}`);
    await sleep(3000);
  }
  throw new Error(`${phase}: timed out; retain evidence and reuse --output`);
}
const kubeArgs = ['--kubeconfig', resolve(options.kubeconfig), '--request-timeout=25s', ...(options['insecure-kubernetes'] ? ['--insecure-skip-tls-verify=true'] : [])];
function kube(args, json = true) {
  const r = spawnSync('kubectl', [...kubeArgs, '-n', state.target.namespace, ...args], { encoding: 'utf8', windowsHide: true, timeout: 35000, maxBuffer: 8 << 20 });
  assert.equal(r.status, 0, `kubectl ${args[0]} failed; inspect access and resource state`);
  return json ? JSON.parse(r.stdout) : r.stdout;
}
const attempts = () => api('GET', `/builds/${state.buildId}/attempts`);
const buildDetail = () => api('GET', `/builds/${state.buildId}`);
const podsFor = uid => kube(['get', 'pods', '-l', `batch.kubernetes.io/controller-uid=${uid}`, '-o', 'json']).items;
const condition = (job, kind) => job.status.conditions?.some(c => c.type === kind && c.status === 'True');
const normalizedInput = input => {
  const copy = { ...input }; delete copy.attemptId; delete copy.jobName; delete copy.requestedBy;
  return hash(JSON.stringify(copy));
};
function readInput(attempt) {
  const cm = kube(['get', 'configmap', `${attempt.jobName}-spec`, '-o', 'json']);
  assert(cm.immutable && cm.metadata.ownerReferences.some(o => o.uid === attempt.jobUid));
  const input = JSON.parse(cm.data['input.json']);
  assert.equal(input.attemptId, attempt.id); assert.equal(input.jobName, attempt.jobName);
  assert.equal(input.buildId, state.buildId); assert.equal(input.appId, state.appId);
  assert.equal(input.commitSha, state.commitSha);
  assert.equal(input.namespace, state.target.namespace); assert.equal(input.clusterId, state.target.clusterId);
  return input;
}
async function checkRegistry(artifact) {
  assert.equal(artifact.imageRef, `${artifact.imageRepository}@${artifact.digest}`);
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  const slash = artifact.imageRepository.indexOf('/'); assert(slash > 0);
  const authority = new URL('https://' + artifact.imageRepository.slice(0, slash));
  assert(!authority.username && !authority.password && authority.pathname === '/' && !authority.search && !authority.hash);
  const prefix = `${authority.origin}/v2/${artifact.imageRepository.slice(slash + 1)}`;
  const visited = new Set(); let blobs = 0;
  async function manifest(digest) {
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    if (visited.has(digest)) return;
    visited.add(digest); assert(visited.size <= 32);
    const r = await response(`${prefix}/manifests/${digest}`, { headers: { Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json' } });
    assert.equal(r.status, 200); assert.equal(hash(r.bytes), digest);
    const data = JSON.parse(r.bytes);
    if (data.manifests) for (const item of data.manifests) await manifest(item.digest);
    else for (const item of [data.config, ...data.layers]) {
      assert.match(item.digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal((await response(`${prefix}/blobs/${item.digest}`, { method: 'HEAD' })).status, 200); blobs++;
    }
  }
  await manifest(artifact.digest); return { manifests: [...visited], blobs, verifiesTLS: true };
}
async function observeRelease(id) {
  const deployment = await wait('release', () => api('GET', `/deployments/${id}`), d => d.status === 'succeeded');
  assert.equal(deployment.appId, state.appId); assert.equal(deployment.bindingId, state.bindingId);
  assert.equal(deployment.artifactId, state.artifact.id); assert.equal(deployment.imageRef, state.artifact.imageRef);
  assert(deployment.helmRevision > 0);
  const jobs = kube(['get', 'jobs', '-l', `podry.io/deployment-id=${id}`, '-o', 'json']).items;
  assert.equal(jobs.length, 1); const job = jobs[0];
  assert(condition(job, 'Complete') && job.status.succeeded === 1);
  assert.equal(job.metadata.labels['podry.io/binding-id'], state.bindingId);
  assert.equal(job.metadata.annotations['meta.helm.sh/release-name'], state.target.releaseName);
  assert.equal(job.spec.template.spec.containers[0].image, state.artifact.imageRef);
  const pods = podsFor(job.metadata.uid); assert.equal(pods.length, 1); const pod = pods[0];
  assert(pod.metadata.ownerReferences.some(o => o.uid === job.metadata.uid && o.controller));
  assert.equal(pod.status.phase, 'Succeeded');
  assert.equal(pod.spec.containers[0].image, state.artifact.imageRef);
  const container = pod.status.containerStatuses.find(c => c.name === 'app');
  assert.equal(container.state.terminated.exitCode, 0); assert.equal(container.imageID, state.artifact.imageRef);
  assert.equal(kube(['logs', pod.metadata.name, '-c', 'app', '--tail=10'], false).trim(), 'podry-job: pong');
  const storage = kube(['get', 'secret', `sh.helm.release.v1.${state.target.releaseName}.v${deployment.helmRevision}`, '-o', 'json']);
  const helm = JSON.parse(gunzipSync(Buffer.from(Buffer.from(storage.data.release, 'base64').toString(), 'base64')));
  assert.equal(helm.info.status, 'deployed'); assert.equal(helm.version, deployment.helmRevision);
  assert.equal(helm.chart.metadata.version, state.chartVersion);
  assert(helm.manifest.includes('kind: Job\n') && helm.manifest.includes(job.metadata.name) && helm.manifest.includes(id));
  assert(!/kind: (?:Ingress|Service)\n/.test(helm.manifest));
  const bindings = await api('GET', `/apps/${state.appId}/environments`);
  assert.equal((bindings.items ?? bindings).find(b => b.id === state.bindingId)?.currentDeploymentId, id);
  await api('GET', `/apps/${state.appId}/resources?bindingId=${state.bindingId}`);
  await api('GET', `/deployments/${id}/diff`);
  return { deployment, job: { name: job.metadata.name, uid: job.metadata.uid, complete: true },
    pod: { name: pod.metadata.name, uid: pod.metadata.uid, exitCode: 0, imageID: container.imageID, log: 'podry-job: pong' },
    helm: { revision: helm.version, chartVersion: helm.chart.metadata.version, status: helm.info.status, chartMetadataSHA256: hash(JSON.stringify(helm.chart)) }, currentDeploymentId: id };
}

try {
  const config = await api('GET', `/apps/${state.appId}/config`);
  assert.equal(config.chartConfig?.workloadKind, 'Job', 'Use a dedicated finite Job application');
  const hold = Number(config.buildConfig?.buildArgs?.BUILD_HOLD_SECONDS);
  assert(Number.isInteger(hold) && hold >= 30 && hold <= 300);
  assert.equal(config.buildConfig.dockerfile, 'Dockerfile.job');
  const bindings = await api('GET', `/apps/${state.appId}/environments`);
  const binding = (bindings.items ?? bindings).find(b => b.id === state.bindingId);
  assert(binding && !binding.autoDeploy, 'Dedicated manual binding required');
  assert(!state.target || JSON.stringify(state.target) === JSON.stringify(binding.target), 'Binding target changed');
  state.target = binding.target; state.chartVersion ??= config.chartConfig.chartVersion;
  if (!state.buildId) {
    const commits = await api('GET', `/apps/${state.appId}/git/commits?ref=${encodeURIComponent(config.gitConfig.branch)}&limit=1`);
    assert.equal(commits.items.length, 1);
    // Commit-list ordering is not a branch-head contract (timestamps can tie or
    // go backwards). Freeze the advertised ref returned by the same query.
    assert.match(commits.resolvedRef, /^[0-9a-f]{40}$/);
    state.commitSha ??= commits.resolvedRef; state.configVersion ??= commits.configVersion;
    await save();
    const build = await api('POST', `/apps/${state.appId}/builds`, { commitSha: state.commitSha, expectedConfigVersion: state.configVersion }, 202, state.runId + ':build');
    state.buildId = build.id; state.originalCreatedAt = build.createdAt; await save();
  }
  if (!state.cancelGate) {
    await wait('running-barrier', buildDetail, async build => {
      assert.equal(build.attemptNo, 1); if (build.status !== 'running') return false;
      const attempt = (await attempts()).find(a => a.attemptNo === 1); if (!attempt?.jobUid) return false;
      const job = kube(['get', 'job', attempt.jobName, '-o', 'json']); assert.equal(job.metadata.uid, attempt.jobUid);
      const pods = podsFor(attempt.jobUid);
      const pod = pods.find(p => p.status.containerStatuses?.find(c => c.name === 'build')?.state.running);
      if (!pod) return false;
      const logs = kube(['logs', pod.metadata.name, '-c', 'build', '--tail=200'], false);
      // Match executed BuildKit output, never the printed Dockerfile RUN command.
      const line = logs.split(/\r?\n/).find(s => new RegExp(`^#\\d+ \\d+(?:\\.\\d+)? podry-live-build-hold:${hold}$`).test(s));
      if (!line) return false;
      const input = readInput(attempt);
      state.cancelGate = { observedAt: new Date().toISOString(), attempt, jobUid: job.metadata.uid, podUid: pod.metadata.uid, executedOutput: line, frozenInputSHA256: normalizedInput(input), runnerImage: input.runnerImage, imageTag: new URL(input.registryEndpoint).host + '/' + input.imageRepository + ':podry-' + input.attemptId.replaceAll('-', '') };
      await event('barrier', line); return true;
    });
  }
  if (!state.cancelResponse) {
    state.cancelResponse = await api('POST', `/builds/${state.buildId}/cancel`, {}, 202, state.runId + ':cancel'); await save();
  }
  assert.deepEqual(await api('POST', `/builds/${state.buildId}/cancel`, {}, 202, state.runId + ':cancel'), state.cancelResponse);
  if (!state.cancellation) {
    const canceled = await wait('cancel', buildDetail, b => b.status === 'canceled');
    assert.equal(canceled.artifactId, null);
    const attempt = (await attempts()).find(a => a.attemptNo === 1);
    assert.equal(attempt.status, 'canceled'); assert(attempt.finishedAt);
    const job = kube(['get', 'job', attempt.jobName, '-o', 'json']); assert.equal(job.metadata.uid, state.cancelGate.jobUid);
    assert.equal(job.spec.suspend, true); assert(condition(job, 'Suspended')); assert.equal(job.status.active ?? 0, 0);
    const pods = podsFor(attempt.jobUid); assert(pods.every(p => ['Succeeded', 'Failed'].includes(p.status.phase)));
    const artifacts = await api('GET', `/apps/${state.appId}/artifacts?page=1&pageSize=100`);
    assert(!artifacts.items.some(a => a.buildId === state.buildId));
    state.cancellation = { confirmedAt: new Date().toISOString(), status: canceled.status, jobUid: job.metadata.uid, suspended: true, active: 0, remainingPods: pods.map(p => ({ uid: p.metadata.uid, phase: p.status.phase })), artifactCreated: false, logAvailability: attempt.logAvailability };
    await event('cancellation', 'confirmed suspended Job, no active Pods, no Artifact');
  }
  if (!state.retryResponse) {
    state.retryResponse = await api('POST', `/builds/${state.buildId}/retry`, {}, 202, state.runId + ':retry'); await save();
  }
  assert.deepEqual(await api('POST', `/builds/${state.buildId}/retry`, {}, 202, state.runId + ':retry'), state.retryResponse);
  assert.equal(state.retryResponse.id, state.buildId); assert.equal(state.retryResponse.attemptNo, 2);
  const build = await wait('retry', buildDetail, b => b.status === 'succeeded');
  assert.equal(build.commitSha, state.commitSha); assert.equal(build.configVersion, state.configVersion);
  assert.equal(build.createdAt, state.originalCreatedAt); assert.equal(build.attemptNo, 2);
  const history = await attempts(); assert.equal(history.length, 2);
  const old = history.find(a => a.attemptNo === 1); const current = history.find(a => a.attemptNo === 2);
  assert.equal(old.status, 'canceled'); assert.equal(current.status, 'succeeded');
  assert.notEqual(current.id, old.id); assert.notEqual(current.jobName, old.jobName); assert.notEqual(current.jobUid, old.jobUid);
  const input = readInput(current); assert.equal(normalizedInput(input), state.cancelGate.frozenInputSHA256);
  const job = kube(['get', 'job', current.jobName, '-o', 'json']); assert.equal(job.metadata.uid, current.jobUid); assert(condition(job, 'Complete'));
  const buildPods = podsFor(current.jobUid); assert.equal(buildPods.length, 1); const pod = buildPods[0];
  assert(pod.metadata.ownerReferences.some(o => o.uid === current.jobUid && o.controller));
  assert.equal(pod.spec.containers[0].image, input.runnerImage); assert.equal(pod.spec.initContainers[0].image, input.runnerImage);
  assert.equal(pod.status.initContainerStatuses[0].state.terminated.exitCode, 0);
  const term = pod.status.containerStatuses.find(c => c.name === 'build').state.terminated; assert.equal(term.exitCode, 0);
  const result = JSON.parse(term.message); assert.equal(result.version, 1); assert.equal(result.attemptId, current.id);
  const artifacts = await api('GET', `/apps/${state.appId}/artifacts?page=1&pageSize=100`);
  const matches = artifacts.items.filter(a => a.buildId === state.buildId); assert.equal(matches.length, 1);
  const artifact = matches[0]; assert.equal(artifact.id, build.artifactId); assert.equal(artifact.source, 'build');
  assert.equal(result.digest, artifact.digest); assert.equal(result.imageRepository, artifact.imageRepository);
  state.artifact = artifact; state.registry = await checkRegistry(artifact);
  state.retry = { build, attempts: history, frozenInputsMatch: true, jobUid: job.metadata.uid, podUid: pod.metadata.uid, imageTag: new URL(input.registryEndpoint).host + '/' + input.imageRepository + ':podry-' + input.attemptId.replaceAll('-', '') };
  assert.notEqual(state.retry.imageTag, state.cancelGate.imageTag); await event('retry-inputs', 'same SHA/config/credentials/runner; new Attempt/Job/tag');
  await wait('log-archive', async () => (await attempts()).find(a => a.attemptNo === 2), a => a.logAvailability === 'archived', []);
  const logs = await response(new URL(`/api/builds/${state.buildId}/logs?attemptNo=2&follow=false`, base), { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(logs.status, 200);
  const frames = logs.bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(frames.some(f => f.type === 'log') && frames.at(-1)?.type === 'end' && !frames.some(f => f.type === 'error'));
  state.logs = { availability: 'archived', bytes: logs.bytes.length, sha256: hash(logs.bytes), lines: frames.filter(f => f.type === 'log').length }; await save();
  if (!state.deploymentId) {
    if (!state.previewId) {
      const preview = await api('POST', `/apps/${state.appId}/deployment-previews`, { bindingId: state.bindingId, artifactId: artifact.id, expectedConfigVersion: state.configVersion }, 201);
      assert.equal(preview.imageRef, artifact.imageRef); assert.deepEqual(preview.target, state.target);
      state.previewId = preview.previewId; await save();
    }
    const request = await api('POST', `/apps/${state.appId}/deployments`, { previewId: state.previewId }, 202, state.runId + ':deploy');
    assert(request.deploymentId); state.deploymentId = request.deploymentId; state.requestId = request.requestId; await save();
  }
  // Helm may delete the first completed Job during rollback; retain its checked
  // evidence before replacing it, rather than expecting historical Pods to live forever.
  if (!state.release) { state.release = await observeRelease(state.deploymentId); await save(); }
  if (!state.rollbackId) {
    const request = await api('POST', `/deployments/${state.deploymentId}/rollback`, { reason: 'Live acceptance: rerun the archived finite Job' }, 202, state.runId + ':rollback');
    assert(request.deploymentId); state.rollbackId = request.deploymentId; state.rollbackRequestId = request.requestId; await save();
  }
  state.rollback = await observeRelease(state.rollbackId);
  assert.equal(state.rollback.deployment.sourceDeploymentId, state.deploymentId);
  assert.equal(state.rollback.deployment.kind, 'rollback');
  assert.notEqual(state.release.job.name, state.rollback.job.name); assert.notEqual(state.release.job.uid, state.rollback.job.uid);
  assert.equal(state.rollback.helm.revision, state.release.helm.revision + 1);
  assert.equal(state.release.helm.chartMetadataSHA256, state.rollback.helm.chartMetadataSHA256);
  state.result = 'passed'; state.finishedAt = new Date().toISOString(); delete state.error;
  await event('acceptance', 'passed');
} catch (error) {
  state.result = 'failed'; state.error = error.message; await save(); console.error(error.message); process.exitCode = 1;
}
