// Offline query, matching and discovery checks against local fixtures only.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const server = await createServer({ configFile: false, resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const checks = []
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
try {
  const f = await server.ssrLoadModule('/src/utils/resourceFilters.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const empty = () => f.readNodeFilters({})
  const parsed = f.readNodeFilters({ label: 'zone=a,, zone=b,zone=a,', nodeGroup: ['mainnode,mainnode-2', 'ignored'], k8sVersion: null })
  check('URL values trim blanks and deduplicate', parsed.label.join('|') === 'zone=a|zone=b')
  check('Repeated URL key uses first value', parsed.nodeGroup.join('|') === 'mainnode|mainnode-2')
  check('Absent categories produce empty arrays', parsed.k8sVersion.length === 0)
  const node = { name: 'node-a', labels: { zone: 'a', role: '', token: 'a=b' }, nodeGroup: 'mainnode', k8sVersion: 'v1.29.4' }
  check('No applied filters includes node', f.matchesNodeFilters(node, empty()))
  check('Node search is trimmed and case insensitive', f.matchesNodeFilters(node, empty(), ' NODE-A '))
  check('Search does not match labels', !f.matchesNodeFilters(node, empty(), 'zone'))
  check('Node groups match exactly', !f.matchesNodeFilters({ ...node, nodeGroup: 'mainnode-2' }, { ...empty(), nodeGroup: ['mainnode'] }))
  check('Multiple groups use OR', f.matchesNodeFilters(node, { ...empty(), nodeGroup: ['other', 'mainnode'] }))
  check('Multiple labels use OR', f.matchesNodeFilters(node, { ...empty(), label: ['zone=b', 'zone=a'] }))
  check('Labels compare key and value exactly', !f.matchesNodeFilters(node, { ...empty(), label: ['zone=ab'] }))
  check('Empty label value is valid', f.matchesNodeFilters(node, { ...empty(), label: ['role='] }))
  check('Empty label value cannot match a missing key', !f.matchesNodeFilters(node, { ...empty(), label: ['missing='] }))
  check('Label values retain equals characters', f.matchesNodeFilters(node, { ...empty(), label: ['token=a=b'] }))
  check('Malformed label cannot neutralize filtering', !f.matchesNodeFilters(node, { ...empty(), label: ['zone'] }))
  check('Label and group use AND', !f.matchesNodeFilters(node, { ...empty(), label: ['zone=b'], nodeGroup: ['mainnode'] }))
  check('Version is exact not a substring', !f.matchesNodeFilters(node, { ...empty(), k8sVersion: ['v1.29.40'] }))
  check('Multiple versions use OR', f.matchesNodeFilters(node, { ...empty(), k8sVersion: ['v1.30.1', 'v1.29.4'] }))
  check('Version and labels use AND', !f.matchesNodeFilters(node, { ...empty(), k8sVersion: ['v1.30.1'], label: ['zone=a'] }))
  check('Blank values never bypass active group', !f.matchesNodeFilters(node, { ...empty(), nodeGroup: ['', 'other'] }))
  check('Missing version does not match a selected version', !f.matchesNodeFilters({ ...node, k8sVersion: '' }, { ...empty(), k8sVersion: ['v1.29.4'] }))
  const resources = await api.listResources('c-prod', { group: '', resource: 'nodes' })
  const nodes = await Promise.all(resources.map(async item => f.nodeFilterData(item, await api.getNodeDetail('c-prod', item.ref.name))))
  const options = f.nodeFilterOptions(nodes)
  check('Node group fixture distinguishes similar group names', options.nodeGroup.join('|') === 'mainnode|mainnode-2')
  check('Version options deduplicate full node data', options.k8sVersion.join('|') === 'v1.29.4')
  check('Node labels merge manifest and detail metadata', options.label.includes('eks.amazonaws.com/nodegroup=mainnode') && options.label.includes('topology.kubernetes.io/zone=az-b'))
  check('Fixture exact group returns one node', nodes.filter(node => f.matchesNodeFilters(node, { ...empty(), nodeGroup: ['mainnode'] })).length === 1)
  const sparse = f.nodeFilterData({ ...resources[0], manifest: 'metadata:\n  labels: []\n' })
  check('Sparse node data yields no fabricated filter values', !sparse.nodeGroup && !sparse.k8sVersion && !Object.keys(sparse.labels).length)
  check('Empty groups and versions never appear as options', f.nodeFilterOptions([sparse]).nodeGroup.length === 0 && f.nodeFilterOptions([sparse]).k8sVersion.length === 0)
  check('Cloud provider node group labels are supported', f.nodeGroupLabel({ 'cloud.google.com/gke-nodepool': 'pool-a' }) === 'pool-a' && f.nodeGroupLabel({ 'kubernetes.azure.com/agentpool': 'pool-b' }) === 'pool-b')
  const kinds = [
    { key: 'a', label: 'Project', resource: 'projects', group: 'other', description: 'other', shortNames: [] },
    { key: 'b', label: 'Rollout', resource: 'rollouts', group: 'delivery', description: 'delivery', shortNames: ['pro'] },
    { key: 'c', label: 'Rollout', resource: 'rollouts', group: 'argo', description: 'argo', shortNames: ['ro'] },
  ]
  check('Empty kind search does not open all options', f.searchKinds(kinds, '').length === 0)
  check('Exact shortname outranks ordinary substring', f.searchKinds(kinds, 'pro')[0].key === 'b')
  check('Duplicate kinds preserve group identity', f.searchKinds(kinds, 'rollout').map(item => item.key).join() === 'b,c')
  check('Kind search matches API group', f.searchKinds(kinds, 'ARGO')[0].key === 'c')
  check('Unknown kind produces no results', f.searchKinds(kinds, 'unknown').length === 0)
  console.log(`PASS ${checks.length} offline resource filter checks; frontend Mock only`)
} finally { await server.close() }
