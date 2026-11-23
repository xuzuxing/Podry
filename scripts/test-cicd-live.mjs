// Explicit live acceptance against an already configured backend and application.
// Authentication comes only from PODRY_LIVE_TOKEN. Evidence never contains it.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: {
  api: { type: 'string' }, app: { type: 'string' }, binding: { type: 'string' },
  output: { type: 'string' }, kubeconfig: { type: 'string' },
  'build-id': { type: 'string' }, 'timeout-seconds': { type: 'string', default: '1200' },
  'auto-deploy': { type: 'boolean', default: false },
  'promote-from': { type: 'string' },
  'insecure-kubernetes': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (options.help) {
  console.log('PODRY_LIVE_TOKEN=<access token> node scripts/test-cicd-live.mjs --api http://127.0.0.1:15000 --app UUID --binding UUID --kubeconfig docs/k3s.yaml --output /outside-repo/evidence.json [--build-id UUID] [--auto-deploy | --promote-from SOURCE_DEPLOYMENT] [--insecure-kubernetes]');
  console.log('Creates a real build and Helm deployment, checks Registry bytes, Job/Pod identity, archived logs and GET /ping. --auto-deploy observes the on_ci_success request without manual preview/confirmation. --promote-from SOURCE_DEPLOYMENT --build-id BUILD promotes that existing Artifact to the manual binding. Reusing --output resumes recorded IDs and idempotency keys. Does not delete resources. Trust private CAs with NODE_EXTRA_CA_CERTS or Node --use-system-ca.');
  process.exit(0);
}
for (const name of ['api', 'app', 'binding', 'output', 'kubeconfig']) assert(options[name], `--${name} is required`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
assert(uuid.test(options.app) && uuid.test(options.binding), 'Application and binding must be UUIDs');
if (options['build-id']) assert(uuid.test(options['build-id']), 'Build ID must be a UUID');
if (options['promote-from']) {
  assert(uuid.test(options['promote-from']), 'Source Deployment must be a UUID');
  assert(options['build-id'] && !options['auto-deploy'], 'Promotion requires --build-id and a manual target');
}
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
state ??= { schemaVersion: 1, runId: randomUUID(), api: base.origin, appId: options.app, bindingId: options.binding, automatic: options['auto-deploy'], promoteFrom: options['promote-from'] ?? null, startedAt: new Date().toISOString(), events: [] };
assert(state.schemaVersion === 1 && state.api === base.origin && state.appId === options.app && state.bindingId === options.binding, 'Evidence belongs to another application or API');
const automatic = options['auto-deploy'];
assert.equal(state.automatic ?? false, automatic, 'Evidence belongs to another deployment mode');
state.automatic = automatic;
assert.equal(state.promoteFrom ?? null, options['promote-from'] ?? null, 'Evidence belongs to another promotion source');
if (options['build-id']) {
  assert(!state.buildId || state.buildId === options['build-id'], 'Evidence belongs to another build');
  state.buildId = options['build-id'];
}
await mkdir(dirname(output), { recursive: true });
const save = async () => {
  await writeFile(output + '.tmp', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(output + '.tmp', output);
};
const event = async (phase, value) => {
  state.events.push({ at: new Date().toISOString(), phase, value });
  console.log(`${phase}: ${value}`);
  await save();
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
const hash = data => 'sha256:' + createHash('sha256').update(data).digest('hex');
async function response(url, init = {}, limit = 4 << 20) {
  const result = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const chunks = [];
  let size = 0;
  for await (const chunk of result.body ?? []) {
    size += chunk.length;
    assert(size <= limit, 'HTTP response exceeded acceptance budget');
    chunks.push(chunk);
  }
  return { status: result.status, headers: result.headers, bytes: Buffer.concat(chunks) };
}
async function api(method, path, body, expected = 200, key) {
  const result = await response(new URL('/api' + path, base), {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = JSON.parse(result.bytes); }
  catch { throw new Error(`${method} ${path}: non-JSON response (${result.status})`); }
  assert.equal(result.status, expected, `${method} ${path}: HTTP ${result.status}, ${data.error?.code ?? 'unexpected_status'}`);
  return data;
}
async function poll(phase, get) {
  const deadline = Date.now() + timeout * 1000;
  let previous;
  while (Date.now() < deadline) {
    const result = await get();
    state[phase] = result;
    if (result.status !== previous) {
      previous = result.status;
      await event(phase, result.status);
    }
    assert(!['failed', 'cancelled', 'canceled'].includes(result.status), `${phase} failed (${result.errorCode ?? result.status})`);
    if (result.status === 'succeeded') { await save(); return result; }
    // unknown is evidence of an unresolved result; it never causes a new submit.
    await sleep(3000);
  }
  throw new Error(`${phase} timed out; retain evidence and rerun with the same --output`);
}
const kubectlArgs = ['--kubeconfig', resolve(options.kubeconfig), '--request-timeout=25s', ...(options['insecure-kubernetes'] ? ['--insecure-skip-tls-verify=true'] : [])];
function kube(args) {
  const result = spawnSync('kubectl', [...kubectlArgs, ...args], { encoding: 'utf8', windowsHide: true, timeout: 35000, maxBuffer: 8 << 20 });
  assert.equal(result.status, 0, `kubectl ${args[0]} failed; inspect cluster access and namespace`);
  return JSON.parse(result.stdout);
}
async function checkRegistry(artifact) {
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.imageRef, `${artifact.imageRepository}@${artifact.digest}`);
  const slash = artifact.imageRepository.indexOf('/');
  assert(slash > 0, 'Artifact must include the Registry authority');
  const origin = new URL('https://' + artifact.imageRepository.slice(0, slash));
  assert(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Invalid Registry authority');
  const prefix = `${origin.origin}/v2/${artifact.imageRepository.slice(slash + 1)}`;
  const accept = 'application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json';
  const visited = new Set();
  async function manifest(digest) {
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    if (visited.has(digest)) return;
    visited.add(digest);
    assert(visited.size <= 32, 'Registry manifest graph exceeded budget');
    // The backend access token is never sent to the Registry.
    const result = await response(`${prefix}/manifests/${digest}`, { headers: { Accept: accept } });
    assert.equal(result.status, 200, 'Anonymous Registry manifest read failed');
    assert.equal(hash(result.bytes), digest, 'Registry bytes differ from Artifact digest');
    if (result.headers.has('docker-content-digest')) assert.equal(result.headers.get('docker-content-digest'), digest);
    const value = JSON.parse(result.bytes);
    if (value.manifests) for (const entry of value.manifests) await manifest(entry.digest);
    else for (const blob of [value.config, ...value.layers]) {
      assert.match(blob.digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal((await response(`${prefix}/blobs/${blob.digest}`, { method: 'HEAD' })).status, 200, 'Registry blob missing');
    }
  }
  await manifest(artifact.digest);
  return { imageRef: artifact.imageRef, manifests: [...visited], verifiedAt: new Date().toISOString() };
}
async function checkHTTP(target) {
  const child = spawn('kubectl', [...kubectlArgs, '-n', target.namespace, 'port-forward', '--address=127.0.0.1', `service/${target.releaseName}`, ':80'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  // Register errors immediately so spawn failures cannot escape as unhandled events.
  exited.catch(() => {});
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error('Port-forward readiness timeout')), 20000);
      let text = '';
      const fail = () => { clearTimeout(timer); reject(new Error('Port-forward failed')); };
      child.once('error', fail); child.once('exit', fail);
      child.stdout.on('data', chunk => {
        text += chunk.toString();
        const match = text.match(/Forwarding from 127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
      });
      // Drain stderr; do not copy raw upstream output into evidence.
      child.stderr.resume();
    });
    const ping = await response(`http://127.0.0.1:${port}/ping`);
    assert.equal(ping.status, 200); assert.equal(ping.bytes.toString().trim(), 'pong');
    const root = await response(`http://127.0.0.1:${port}/`);
    assert.equal(root.status, 200); assert(root.bytes.toString().includes('podry-demo'), 'Embedded demo page missing');
    return { transport: 'kubectl port-forward to ClusterIP Service', pingStatus: 200, pingBody: 'pong', embeddedPageStatus: 200 };
  } finally {
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

try {
  const config = await api('GET', `/apps/${state.appId}/config`);
  assert(config.gitConfig && config.buildConfig, 'Git and Build configuration required');
  const bindings = await api('GET', `/apps/${state.appId}/environments`);
  const binding = (bindings.items ?? bindings).find(item => item.id === state.bindingId);
  assert(binding && binding.autoDeploy === automatic, 'Binding must match the selected deployment mode');
  if (automatic) {
    const workflow = await api('GET', `/apps/${state.appId}/pipelines`);
    const pipeline = workflow.items.find(item => item.kind === 'cd' && item.bindingId === state.bindingId);
    const ci = workflow.items.find(item => item.kind === 'ci');
    assert(pipeline?.enabled && ci?.enabled && pipeline.definition.triggerMode === 'on_ci_success' && pipeline.definition.upstreamPipelineId === ci.id, 'Enabled automatic CD with an explicit upstream CI is required');
    assert(!state.pipelineId || state.pipelineId === pipeline.id, 'Automatic pipeline changed');
    state.pipelineId = pipeline.id;
  }
  const target = binding.target;
  assert(!state.target || JSON.stringify(state.target) === JSON.stringify(target), 'Binding target changed');
  state.target = target;
  if (!state.buildId) {
    const commits = await api('GET', `/apps/${state.appId}/git/commits?ref=${encodeURIComponent(config.gitConfig.branch)}&limit=1`);
    assert(commits.items.length === 1, 'Configured branch has no commit');
    // Equal or non-monotonic commit timestamps can put a parent first.
    assert.match(commits.resolvedRef, /^[0-9a-f]{40}$/);
    state.commitSha ??= commits.resolvedRef;
    state.configVersion ??= commits.configVersion;
    await save(); // Persist the key and frozen selection before any mutation.
    const build = await api('POST', `/apps/${state.appId}/builds`, { commitSha: state.commitSha, expectedConfigVersion: state.configVersion }, 202, state.runId + ':build');
    state.buildId = build.id; await save();
  }
  if (automatic) {
    const admitted = await api('GET', `/builds/${state.buildId}`);
    const intent = admitted.autoDeployments?.find(item => item.pipelineId === state.pipelineId && item.bindingId === state.bindingId);
    assert(intent, 'Build admission did not capture the automatic intent');
    state.admittedIntent ??= intent;
    await save();
    // Repeat the exact admission request even on resume: it must identify the same Build.
    // Adopted --build-id runs have no locally recorded admission key to replay.
    if (!options['build-id']) {
      const replay = await api('POST', `/apps/${state.appId}/builds`, { commitSha: state.commitSha, expectedConfigVersion: state.configVersion }, 202, state.runId + ':build');
      assert.equal(replay.id, state.buildId, 'Build idempotency replay created another Build');
      state.buildReplay = { id: replay.id, verified: true };
    }
  }
  const build = await poll('build', async () => {
    const value = await api('GET', `/builds/${state.buildId}`);
    assert.equal(value.appId, state.appId); return value;
  });
  state.commitSha = build.commitSha; state.configVersion = build.configVersion;
  state.attempts = await api('GET', `/builds/${build.id}/attempts`);
  const attempt = state.attempts.find(item => item.attemptNo === build.attemptNo);
  assert(attempt && attempt.status === 'succeeded' && attempt.jobUid, 'Successful Job identity missing');
  const job = kube(['-n', target.namespace, 'get', 'job', attempt.jobName, '-o', 'json']);
  assert.equal(job.metadata.uid, attempt.jobUid);
  assert(job.status.conditions.some(condition => condition.type === 'Complete' && condition.status === 'True'));
  state.job = { name: job.metadata.name, uid: job.metadata.uid, complete: true };
  // This acceptance uses the same dedicated namespace for CI and CD.
  const input = JSON.parse(kube(['-n', target.namespace, 'get', 'configmap', `${attempt.jobName}-spec`, '-o', 'json']).data['input.json']);
  assert.equal(input.commitSha, build.commitSha); assert.equal(input.attemptId, attempt.id);
  assert.equal(input.buildId, build.id); assert.equal(input.appId, state.appId);
  const buildPods = kube(['-n', target.namespace, 'get', 'pods', '-l', `batch.kubernetes.io/controller-uid=${job.metadata.uid}`, '-o', 'json']).items;
  assert.equal(buildPods.length, 1, 'Expected exactly one observed build Pod');
  const buildPod = buildPods[0];
  assert(buildPod.metadata.ownerReferences.some(owner => owner.uid === job.metadata.uid && owner.controller));
  assert.equal(buildPod.spec.initContainers[0].image, input.runnerImage);
  assert.equal(buildPod.spec.containers[0].image, input.runnerImage);
  assert.equal(buildPod.status.initContainerStatuses[0].state.terminated.exitCode, 0);
  const termination = buildPod.status.containerStatuses.find(container => container.name === 'build').state.terminated;
  assert.equal(termination.exitCode, 0);
  const result = JSON.parse(termination.message);
  state.buildPod = { name: buildPod.metadata.name, uid: buildPod.metadata.uid, runner: input.runnerImage, result };
  let artifact;
  for (let page = 1; page <= 100; page++) {
    const list = await api('GET', `/apps/${state.appId}/artifacts?page=${page}&pageSize=100`);
    artifact = list.items.find(item => item.id === build.artifactId);
    if (artifact || page * list.pageSize >= list.total) break;
  }
  assert(artifact && artifact.source === 'build' && artifact.buildId === build.id, 'Expected a real CI Artifact');
  assert.equal(result.version, 1); assert.equal(result.attemptId, attempt.id);
  assert.equal(result.imageRepository, artifact.imageRepository); assert.equal(result.digest, artifact.digest);
  state.artifact = artifact;
  state.registry = await checkRegistry(artifact);
  await event('registry', artifact.digest);
  if (automatic) {
    const deadline = Date.now() + timeout * 1000;
    let previous;
    let dispatched;
    while (Date.now() < deadline) {
      const current = await api('GET', `/builds/${state.buildId}`);
      const intents = current.autoDeployments?.filter(item => item.pipelineId === state.pipelineId && item.bindingId === state.bindingId) ?? [];
      assert.equal(intents.length, 1, 'Expected exactly one automatic intent for this pipeline');
      const intent = intents[0];
      assert.equal(intent.id, state.admittedIntent.id, 'Automatic intent identity changed');
      state.autoDeployment = intent;
      if (intent.status !== previous) { previous = intent.status; await event('automatic', intent.status); }
      assert.notEqual(intent.status, 'skipped', `Automatic intent skipped (${intent.errorCode})`);
      if (intent.status === 'dispatched') { dispatched = intent; break; }
      await sleep(3000);
    }
    assert(dispatched?.requestId, 'Automatic dispatch timed out; retain evidence and resume');
    const request = await api('GET', `/release-requests/${dispatched.requestId}`);
    assert.equal(request.bindingId, state.bindingId);
    assert(uuid.test(request.deploymentId), 'Automatic request has no Deployment');
    assert(!state.requestId || state.requestId === request.requestId, 'Automatic request changed on resume');
    assert(!state.deploymentId || state.deploymentId === request.deploymentId, 'Automatic Deployment changed on resume');
    state.requestId = request.requestId; state.deploymentId = request.deploymentId;
    state.automaticRequest = request;
    await save();
  } else if (state.promoteFrom) {
    const source = await api('GET', `/deployments/${state.promoteFrom}`);
    assert.equal(source.status, 'succeeded');
    assert.equal(source.appId, state.appId); assert.equal(source.artifactId, artifact.id); assert.equal(source.imageRef, artifact.imageRef);
    assert.notEqual(source.bindingId, state.bindingId, 'Promotion must target another binding');
    state.releaseConfigVersion ??= config.version;
    await save();
    const request = await api('POST', `/deployments/${source.id}/promote`, { bindingId: state.bindingId, expectedConfigVersion: state.releaseConfigVersion }, 202, state.runId + ':promote');
    assert.equal(request.kind, 'promote'); assert.equal(request.bindingId, state.bindingId);
    assert(uuid.test(request.deploymentId), 'Promotion has no Deployment');
    assert(!state.requestId || state.requestId === request.requestId, 'Promotion request changed on replay');
    assert(!state.deploymentId || state.deploymentId === request.deploymentId, 'Promotion Deployment changed on replay');
    state.requestId = request.requestId; state.deploymentId = request.deploymentId;
    state.promotionRequest = request;
    await save();
  } else if (!state.deploymentId) {
    if (!state.previewId) {
      // An existing Artifact can be released using a newer application config.
      state.releaseConfigVersion ??= config.version;
      await save();
      const preview = await api('POST', `/apps/${state.appId}/deployment-previews`, { bindingId: state.bindingId, artifactId: artifact.id, expectedConfigVersion: state.releaseConfigVersion }, 201);
      assert.equal(preview.imageRef, artifact.imageRef);
      assert.deepEqual(preview.target, target);
      state.previewId = preview.previewId;
      await save();
    }
    const request = await api('POST', `/apps/${state.appId}/deployments`, { previewId: state.previewId }, 202, state.runId + ':deploy');
    state.requestId = request.requestId; state.deploymentId = request.deploymentId;
    assert(state.deploymentId, 'Deployment identity missing'); await save();
  }
  const deployment = await poll('deployment', async () => {
    const value = await api('GET', `/deployments/${state.deploymentId}`);
    assert.equal(value.appId, state.appId); assert.equal(value.bindingId, state.bindingId); assert.equal(value.artifactId, artifact.id); assert.equal(value.imageRef, artifact.imageRef);
    if (state.promoteFrom) { assert.equal(value.kind, 'promote'); assert.equal(value.sourceDeploymentId, state.promoteFrom); }
    return value;
  });
  assert(deployment.helmRevision > 0, 'Helm revision missing');
  const workload = kube(['-n', target.namespace, 'get', 'deployment', target.releaseName, '-o', 'json']);
  assert.equal(workload.metadata.labels['podry.io/deployment-id'], deployment.id);
  assert.equal(workload.spec.template.spec.containers[0].image, artifact.imageRef);
  assert(workload.status.observedGeneration >= workload.metadata.generation && workload.status.readyReplicas === workload.spec.replicas, 'Deployment not ready');
  const pods = kube(['-n', target.namespace, 'get', 'pods', '-l', `podry.io/binding-id=${state.bindingId}`, '-o', 'json']);
  state.pods = pods.items.filter(pod => pod.metadata.labels['podry.io/deployment-id'] === deployment.id).map(pod => ({ name: pod.metadata.name, uid: pod.metadata.uid, phase: pod.status.phase, image: pod.spec.containers[0].image, imageID: pod.status.containerStatuses?.[0]?.imageID, ready: pod.status.containerStatuses?.[0]?.ready }));
  assert(state.pods.length === workload.spec.replicas && state.pods.every(pod => pod.ready && pod.image === artifact.imageRef && pod.imageID === artifact.imageRef), 'Ready Pod digest evidence missing');
  state.http = await checkHTTP(target);
  await event('http', 'GET /ping = 200 pong; embedded page = 200');
  state.resources = await api('GET', `/apps/${state.appId}/resources?bindingId=${state.bindingId}`);
  state.diff = await api('GET', `/deployments/${deployment.id}/diff`);
  const finalBindings = await api('GET', `/apps/${state.appId}/environments`);
  assert.equal((finalBindings.items ?? finalBindings).find(item => item.id === state.bindingId)?.currentDeploymentId, deployment.id);
  const archiveDeadline = Date.now() + 90000;
  do {
    state.attempts = await api('GET', `/builds/${build.id}/attempts`);
    attempt.logAvailability = state.attempts.find(item => item.id === attempt.id)?.logAvailability;
    if (attempt.logAvailability === 'archived') break;
    await sleep(3000);
  } while (Date.now() < archiveDeadline);
  assert.equal(attempt.logAvailability, 'archived', 'Build logs were not archived before the acceptance deadline');
  const logs = await response(new URL(`/api/builds/${build.id}/logs?attemptNo=${build.attemptNo}&follow=false`, base), { headers: { Authorization: `Bearer ${token}` } }, 8 << 20);
  assert.equal(logs.status, 200, 'Build logs unavailable');
  const frames = logs.bytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(frames.some(frame => frame.type === 'log') && frames.at(-1)?.type === 'end' && !frames.some(frame => frame.type === 'error'), 'Incomplete build logs');
  state.logs = { bytes: logs.bytes.length, sha256: hash(logs.bytes), lines: frames.filter(frame => frame.type === 'log').length, availability: attempt.logAvailability };
  state.result = 'passed'; state.finishedAt = new Date().toISOString(); state.passes = (state.passes ?? 0) + 1; delete state.error;
  await event('acceptance', 'passed');
} catch (error) {
  state.result = 'failed'; state.error = error.message;
  await save(); console.error(error.message); process.exitCode = 1;
}
