// Offline image metadata and asynchronous scope checks; no registry or backend access.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const scopes = []
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { await nextTick(); await nextTick(); await nextTick() }
try {
  const utils = await server.ssrLoadModule('/src/utils/artifactDetails.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { useArtifactDetails } = await server.ssrLoadModule('/src/composables/useArtifactDetails.ts')
  check('Registry port is not an image tag', utils.artifactImageLabel('registry.example:5000/team/app') === 'app')
  check('Port and tag parsed independently', utils.artifactImageLabel('registry.example:5000/team/app:v2') === 'v2')
  check('Full digest shown without dropping algorithm', utils.artifactImageLabel('registry.example:5000/team/app@sha256:abcdef') === 'sha256:abcdef')
  check('Bare name and empty image are supported', utils.artifactImageLabel('app') === 'app' && utils.artifactImageLabel('') === '')
  check('Repository preserves registry port', utils.artifactImageRepository('registry.example:5000/team/app:v2') === 'registry.example:5000/team/app')
  check('Repository strips digest without dropping port', utils.artifactImageRepository('registry.example:5000/team/app@sha256:abcdef') === 'registry.example:5000/team/app')
  const imported = await api.importArtifact('a-checkout', { imageRef: 'registry.example:5000/team/port-image:v2', digest: 'sha256:' + 'a'.repeat(64) })
  check('Import records complete registry repository with port', imported.imageRepository === 'registry.example:5000/team/port-image' && imported.source === 'external' && imported.buildId === null)
  check('Tags trimmed, deduplicated and blank removed', JSON.stringify(utils.artifactMetadataInput([' release ', '', 'release', 'stable'], ' note ')) === JSON.stringify({ releaseTags: ['release', 'stable'], notes: ' note ' }))
  check('20 unique tags accepted', !utils.artifactMetadataError(Array.from({ length: 20 }, (_, i) => String(i)), ''))
  check('21 unique tags rejected', !!utils.artifactMetadataError(Array.from({ length: 21 }, (_, i) => String(i)), ''))
  check('Tag length and note bounds validated', !!utils.artifactMetadataError(['x'.repeat(65)], '') && !!utils.artifactMetadataError([], 'x'.repeat(2001)))
  const artifact = (await api.listArtifacts('a-checkout')).find(item => item.id === 'ar-1011')
  const input = { releaseTags: [' stable ', 'stable'], notes: 'snapshot' }
  const pendingSave = api.updateArtifactMetadata(artifact.id, input)
  input.releaseTags[0] = 'late edit'; input.notes = 'late edit'
  const saved = await pendingSave
  check('Save captures metadata before async delay', saved.releaseTags.join() === 'stable' && saved.notes === 'snapshot')
  saved.releaseTags.push('mutated return')
  check('Returned metadata is an independent copy', (await api.listArtifacts('a-checkout')).find(item => item.id === artifact.id).releaseTags.join() === 'stable')
  await assert.rejects(api.updateArtifactMetadata(artifact.id, { releaseTags: ['x'.repeat(65)], notes: '' }), /64/)
  check('Invalid metadata does not change saved record', (await api.listArtifacts('a-checkout')).find(item => item.id === artifact.id).notes === 'snapshot')
  await assert.rejects(api.updateArtifactMetadata('missing-artifact', { releaseTags: [], notes: '' }), /不存在/)
  check('Missing artifact cannot be recreated by metadata save', true)
  const ownBuild = await api.getBuild(artifact.buildId)
  check('Linked build accepted', utils.artifactBuild(artifact, ownBuild)?.id === ownBuild.id)
  check('Cross-app build rejected', utils.artifactBuild(artifact, { ...ownBuild, appId: 'wrong-app' }) === null)
  check('Wrong build ID rejected', utils.artifactBuild(artifact, { ...ownBuild, id: 'wrong-build' }) === null)
  check('External image cannot acquire build source', utils.artifactBuild({ ...artifact, source: 'external' }, ownBuild) === null)
  check('Missing build does not invent a snapshot', utils.artifactBuild(artifact, null) === null)
  const active = shallowRef(false), appId = shallowRef('a-checkout'), id = shallowRef(artifact.id)
  const reads = [], buildReads = []
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useArtifactDetails({ active: () => active.value, appId: () => appId.value, artifactId: () => id.value }, {
    listArtifacts: app => { const task = { app, ...deferred() }; reads.push(task); return task.promise },
    getBuild: build => { const task = { build, ...deferred() }; buildReads.push(task); return task.promise },
  }))
  check('Closed details do not fetch', reads.length === 0)
  active.value = true; await flush()
  reads.at(-1).resolve([artifact]); await flush()
  check('Build fetched directly by recorded ID', buildReads.length === 1 && buildReads[0].build === artifact.buildId)
  active.value = false; await flush()
  buildReads[0].resolve(ownBuild); await flush()
  check('Closing invalidates pending source', !state.build.value && !state.loading.value)
  active.value = true; await flush(); const stale = reads.at(-1)
  id.value = 'external'; await flush(); reads.at(-1).resolve([{ ...artifact, id: 'external', source: 'external', buildId: null }]); await flush()
  stale.resolve([artifact]); await flush()
  check('Slow previous image cannot replace selection', state.artifact.value.id === 'external' && !state.build.value)
  check('External source never fetches a build', buildReads.length === 1)
  const retry = state.load(); reads.at(-1).reject(new Error('offline')); await retry
  check('Read failure exposes retry state', state.error.value === 'offline' && !state.loading.value)
  const recovered = state.load(); reads.at(-1).resolve([]); await recovered
  check('Missing artifact is a distinct empty result', !state.artifact.value && !state.error.value)
  id.value = artifact.id; await flush(); reads.at(-1).resolve([{ ...artifact, appId: 'another-app' }]); await flush()
  check('Artifact app ownership is checked', !state.artifact.value)
  const sourceFailure = state.load(); reads.at(-1).resolve([artifact]); await flush(); buildReads.at(-1).reject(new Error('source unavailable')); await sourceFailure
  check('Source failure retains image metadata', state.artifact.value.id === artifact.id && state.sourceError.value === 'source unavailable' && !state.error.value)
  const last = state.load(); const pending = reads.at(-1); scope.stop(); pending.resolve([artifact]); await last
  check('Disposed workspace ignores pending reads', !state.artifact.value)
  check('Mock saved record still belongs to original app', (await api.listArtifacts('a-payment')).every(item => item.notes !== 'snapshot'))
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
console.log(`Completed ${count} artifact checks`)
