// 使用 Vite 的 TypeScript/alias 加载器验证本地 Mock 状态变化，不连接后端或集群。
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const deployment = await api.getResource('c-prod', 'apps', 'deployments', 'shop-prod', 'checkout-api')
  await api.performResourceAction('c-prod', { ref: deployment.ref, action: 'scale', replicas: 7 })
  assert.match((await api.getResource('c-prod', 'apps', 'deployments', 'shop-prod', 'checkout-api')).manifest, /^  replicas: 7$/m)
  await assert.rejects(api.getResource('c-dev', 'apps', 'deployments', 'shop-prod', 'checkout-api'), /资源不存在/)

  const namespace = await api.getResource('c-prod', '', 'namespaces', '_cluster', 'shop-prod')
  const changedNamespace = namespace.manifest.replace('metadata:', 'metadata:\n  labels:\n    team: commerce')
  assert.equal((await api.applyResource('c-prod', { manifest: changedNamespace, expectedUid: namespace.ref.uid })).status, 'succeeded')
  assert.match((await api.getResource('c-prod', '', 'namespaces', '_cluster', 'shop-prod')).manifest, /team: commerce/)

  const manifest = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: parity-isolation\n  namespace: default\ndata:\n  stage: original\n'
  await api.applyResource('c-prod', { manifest })
  await api.applyResource('c-dev', { manifest: manifest.replace('original', 'development') })
  const prod = await api.getResource('c-prod', '', 'configmaps', 'default', 'parity-isolation')
  const dev = await api.getResource('c-dev', '', 'configmaps', 'default', 'parity-isolation')
  assert.notEqual(prod.ref.uid, dev.ref.uid)
  assert.match(prod.manifest, /original/)
  assert.match(dev.manifest, /development/)
  await api.performResourceAction('c-prod', { ref: prod.ref, action: 'delete' })
  assert.equal((await api.applyResource('c-prod', { manifest, expectedUid: prod.ref.uid })).status, 'failed')
  await assert.rejects(api.getResource('c-prod', '', 'configmaps', 'default', 'parity-isolation'), /资源不存在/)
  assert.match((await api.getResource('c-dev', '', 'configmaps', 'default', 'parity-isolation')).manifest, /development/)
  console.log('PASS Mock scale, cluster isolation, Namespace apply, stale UID rejection; no backend/cluster execution')
} finally { await server.close() }
