// Resource detail URL boundaries and compatibility, without APIs or a browser.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { resolve } from 'node:path'
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
try {
  const { resourceTabAddress, resourceDetailTab, resourceContainer, resourceDetailQuery, detailQueryText } = await server.ssrLoadModule('/src/utils/resourceDetailLocation.ts')
  const pod = { id: 'c-prod|c-prod||pods|shop-prod|checkout-api', scope: 'c-prod', clusterId: 'c-prod', group: '', resource: 'pods', namespace: 'shop-prod', name: 'checkout-api', kind: 'Pod', tab: 'logs', container: 'envoy' }
  check('A core Pod URL carries enough identity to restore a fresh session', resourceTabAddress(pod.id, 'c-prod', 'c-prod')?.name === 'checkout-api')
  check('Infrastructure cannot restore an application scoped tab', resourceTabAddress('app:checkout:c-prod|c-prod||pods|shop-prod|checkout-api', 'c-prod', 'c-prod') === null)
  check('Application URLs retain their complete scope', resourceTabAddress('app:checkout:c-prod|c-prod||pods|shop-prod|checkout-api', 'app:checkout:c-prod', 'c-prod')?.scope === 'app:checkout:c-prod')
  check('Foreign clusters cannot leak into the current workspace', resourceTabAddress(pod.id, 'c-prod', 'c-dev') === null)
  check('Same name custom resources retain API group identity', resourceTabAddress('c-prod|c-prod|argoproj.io|rollouts|shop-prod|checkout-api', 'c-prod', 'c-prod')?.group === 'argoproj.io')
  check('Cluster scoped RBAC names allow their real colon syntax', resourceTabAddress('c-prod|c-prod|rbac.authorization.k8s.io|clusterroles|_cluster|system:discovery', 'c-prod', 'c-prod')?.name === 'system:discovery')
  check('Truncated and extra-part identifiers are ignored', ['c-prod', pod.id + '|extra', pod.id.replace('|pods|', '|Pods|')].every(id => !resourceTabAddress(id, 'c-prod', 'c-prod')))
  check('Path separators and invalid namespaces cannot become resource addresses', [pod.id.replace('checkout-api', '../secret'), pod.id.replace('shop-prod', 'other.namespace'), pod.id.replace('checkout-api', 'bad%2Fname')].every(id => !resourceTabAddress(id, 'c-prod', 'c-prod')))
  check('Core Pod alone supports logs and terminal', resourceDetailTab('logs', pod) === 'logs' && resourceDetailTab('terminal', { ...pod, group: 'custom.io' }) === 'manifest')
  check('Unknown detail modes fall back to Manifest', resourceDetailTab('arbitrary', pod) === 'manifest')
  check('Events remain available for workload resources', resourceDetailTab('events', { group: 'apps', resource: 'deployments' }) === 'events')
  check('Container URL validates DNS label and length', resourceContainer('envoy-2') === 'envoy-2' && ['', '-bad', 'bad/name', 'A', 'a'.repeat(64)].every(name => !resourceContainer(name)))
  const previous = { env: 'binding-1', namespace: 'shop-prod', searchKey: 'api', pageNumber: '2', resourceTab: 'manifest', container: 'old' }
  const next = resourceDetailQuery(previous, pod)
  check('Detail transitions retain environment and list context', next.env === 'binding-1' && next.pageNumber === '2' && next.searchKey === 'api')
  check('Detail URL records both mode and container', next.resourceTab === 'logs' && next.container === 'envoy')
  check('Query updates do not mutate the previous route', previous.resourceTab === 'manifest' && previous.container === 'old')
  check('Returning to fixed listing removes detail-only state', resourceDetailQuery(previous).resourceTab === undefined && resourceDetailQuery(previous).container === undefined)
  check('Non Pod URLs cannot retain a Pod container', resourceDetailQuery(previous, { ...pod, resource: 'services', kind: 'Service' }).container === undefined)
  check('Repeated query parameters read a single deterministic value', detailQueryText(['logs', 'terminal']) === 'logs' && detailQueryText(null) === '')
  console.log(`${count} resource detail location checks passed`)
} finally { await server.close() }
