// 本地 YAML、Mock 和异步草稿状态验证；不连接 Kubernetes，也不验证 Kubernetes schema。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef, nextTick } from 'vue'

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
const scopes = []
const check = (name, result) => { assert.ok(result, name); count++; console.log('PASS ' + name) }
const rejected = async (name, promise, pattern) => { await assert.rejects(promise, pattern); count++; console.log('PASS ' + name) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const utils = await server.ssrLoadModule('/src/utils/resourceManifest.ts')
  const { useResourceManifest } = await server.ssrLoadModule('/src/composables/useResourceManifest.ts')
  const fixtures = await server.ssrLoadModule('/src/mock/data.ts')
  const inconsistent = fixtures.resources.filter(item => utils.validateResourceEdit(item.manifest, item)).map(item => item.ref.resource + '/' + item.ref.namespace + '/' + item.ref.name)
  assert.deepEqual(inconsistent, [], '所有资源 fixture 的 Manifest 身份应与引用一致')
  check('所有资源 fixture 的 Manifest 身份与引用一致', true)
  const manifest = `# exact original comment
apiVersion: v1
kind: ConfigMap
metadata:
  name: manifest-parity
  namespace: default
  uid: stable-uid
  resourceVersion: "41"
  generation: 2
  creationTimestamp: "2026-11-22T00:00:00Z"
  managedFields:
    - manager: kubectl
      fieldsV1:
        f:data:
          f:managedFields: {}
data:
  managedFields: business-value
  namespace: business-namespace
  multiline: |
    kind: NotAResource
    name: not-the-name
  value: 'before'
`
  const hidden = utils.resourceManifestView(manifest, true)
  check('隐藏整个 metadata.managedFields 子树', hidden.hasManagedFields && !hidden.text.includes('manager: kubectl') && !hidden.text.includes('fieldsV1:'))
  check('保留 UID、资源版本、代数及创建时间', ['uid: stable-uid', 'resourceVersion: "41"', 'generation: 2', 'creationTimestamp:'].every(text => hidden.text.includes(text)))
  check('保留同名业务字段、多行内容与注释', hidden.text.includes('managedFields: business-value') && hidden.text.includes('name: not-the-name') && hidden.text.includes('# exact original comment'))
  check('显示托管字段时原文完全保留', utils.resourceManifestView(manifest, false).text === manifest)
  check('没有托管字段时原文完全保留', utils.resourceManifestView(hidden.text, true).text === hidden.text)
  const broken = 'metadata: [broken'
  check('坏 YAML 显示完整原文及错误', utils.resourceManifestView(broken, true).text === broken && utils.resourceManifestView(broken, true).error)
  const flow = 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: flow, managedFields: [{manager: controller}], uid: keep}\ndata: {managedFields: business}\n'
  const flowView = utils.resourceManifestView(flow, true)
  check('flow YAML 按节点删除且保留业务字段', !flowView.text.includes('controller') && flowView.text.includes('uid: keep') && flowView.text.includes('managedFields: business'))
  await api.applyResource('c-prod', { manifest })
  const resource = await api.getResource('c-prod', '', 'configmaps', 'default', 'manifest-parity')
  check('Mock 按资源根节点读取身份，忽略多行内伪字段', resource.kind === 'ConfigMap' && resource.ref.name === 'manifest-parity' && resource.ref.namespace === 'default')
  check('单文档创建精确保留注释、引号及空白', resource.manifest === manifest)
  for (const [label, value] of [
    ['空文档', ''], ['标量', 'hello'], ['序列', '- hello'], ['坏 YAML', broken],
    ['重复键', manifest + 'kind: Secret\n'], ['缺少名字', 'apiVersion: v1\nkind: ConfigMap\nmetadata: {}'],
    ['非字符串名字', manifest.replace('name: manifest-parity', 'name: 42')],
    ['多文档', manifest + '\n---\n' + manifest],
    ['换名字', manifest.replace('name: manifest-parity', 'name: changed')],
    ['换 Kind', manifest.replace('kind: ConfigMap', 'kind: Secret')],
    ['换版本', manifest.replace('apiVersion: v1', 'apiVersion: v2')],
    ['换命名空间', manifest.replace('namespace: default', 'namespace: other')],
  ]) check('现有资源编辑拒绝' + label, Boolean(utils.validateResourceEdit(value, resource)))
  check('现有资源允许字段修改与省略 default 命名空间', !utils.validateResourceEdit(manifest.replace('  namespace: default\n', '').replace("'before'", "'after'"), resource))
  const namespace = await api.getResource('c-prod', '', 'namespaces', '_cluster', 'shop-prod')
  check('集群范围资源拒绝 namespace', utils.validateResourceEdit(namespace.manifest.replace('metadata:', 'metadata:\n  namespace: default'), namespace))
  check('集群范围资源允许无 namespace 的修改', !utils.validateResourceEdit(namespace.manifest + '# namespace comment\n', namespace))
  await rejected('Mock dry-run 拒绝 YAML 语法错误', api.dryRunResource('c-prod', { manifest: broken }), /YAML/)
  check('Mock dry-run 拒绝标量资源', !(await api.dryRunResource('c-prod', { manifest: 'scalar' })).valid)
  check('Mock dry-run 支持带引号的身份', (await api.dryRunResource('c-prod', { manifest: flow })).valid)
  const updatedText = hidden.text.replace("'before'", "'after'")
  check('隐藏字段后可保存现有资源', (await api.applyResource('c-prod', { manifest: updatedText, expectedUid: resource.ref.uid, expectedManifest: manifest })).status === 'succeeded')
  const updated = await api.getResource('c-prod', '', 'configmaps', 'default', 'manifest-parity')
  check('保存后 Mock 保留完整服务端托管字段', updated.manifest.includes('manager: kubectl') && updated.manifest.includes("value: 'after'"))
  await rejected('旧基线不能覆盖并发更新', api.applyResource('c-prod', { manifest, expectedUid: resource.ref.uid, expectedManifest: manifest }), /资源已被更新/)
  check('并发冲突未写入对象', (await api.getResource('c-prod', '', 'configmaps', 'default', 'manifest-parity')).manifest === updated.manifest)
  await rejected('同名资源不能跨集群读取', api.getResource('c-dev', '', 'configmaps', 'default', 'manifest-parity'), /资源不存在/)
  check('失效 UID 不能更新现有对象', (await api.applyResource('c-prod', { manifest, expectedUid: 'stale' })).status === 'failed')
  const insertion = utils.resourceManifestDiff('a\nb\nc', 'a\nnew\nb\nc')
  check('行差异对齐插入位置', insertion.added === 1 && insertion.removed === 0 && insertion.right[1].changed)
  const long = Array.from({ length: 1500 }, (_, i) => 'line-' + i).join('\n')
  check('长清单差异有界且可计算', utils.resourceManifestDiff(long, long + '\nextra').added === 1)

  function harness(service = {}) {
    const scope = effectScope(); scopes.push(scope)
    const current = shallowRef(structuredClone(resource)), cluster = shallowRef('c-prod')
    const calls = []
    const state = scope.run(() => useResourceManifest({ resource: () => current.value, clusterId: () => cluster.value, applied: value => { calls.push(value); current.value = value } }, { dryRun: async () => ({ valid: true, documents: [] }), apply: async () => ({ status: 'succeeded', items: [] }), get: async () => updated, ...service }))
    return { scope, current, cluster, state, calls }
  }
  const h = harness(), s = h.state
  s.edit(); s.draft.value += '# changed\n'; await s.review()
  check('编辑并校验进入原位 review 状态', s.mode.value === 'review' && s.canApply.value && s.dirty.value)
  s.draft.value += '# changed again\n'
  check('预览右侧继续编辑立即失效旧校验', !s.canApply.value && s.validated.value === null)
  await s.review(); await s.apply()
  check('应用后读回并清理草稿', h.calls.length === 1 && s.mode.value === 'read' && !s.dirty.value && !s.saving.value)
  const wait = deferred(), stale = harness({ dryRun: () => wait.promise })
  stale.state.edit(); stale.state.draft.value += '# one\n'
  const reviewing = stale.state.review(); stale.state.draft.value += '# two\n'
  wait.resolve({ valid: true, documents: [] }); await reviewing
  check('迟到校验不覆盖较新的草稿', stale.state.mode.value === 'edit' && !stale.state.canApply.value && !stale.state.checking.value)
  const waitSwitch = deferred(), switching = harness({ dryRun: () => waitSwitch.promise })
  switching.state.edit(); switching.state.draft.value += '# changed\n'
  const switched = switching.state.review(); switching.cluster.value = 'c-dev'; await nextTick()
  waitSwitch.resolve({ valid: true, documents: [] }); await switched
  check('切换集群丢弃迟到校验结果', switching.state.mode.value === 'read' && !switching.state.checking.value)
  const write = deferred(), writing = harness({ apply: () => write.promise })
  writing.state.edit(); writing.state.draft.value += '# writing\n'; await writing.state.review()
  const applied = writing.state.apply(); writing.current.value = { ...resource, manifest: manifest + '# other\n' }
  write.resolve({ status: 'succeeded', items: [] }); await applied
  check('切换资源丢弃迟到写入读回且解除忙碌状态', writing.calls.length === 0 && writing.state.mode.value === 'read' && !writing.state.busy.value)
  const conflict = harness({ apply: async () => { throw new api.MockError('revision_conflict', 'concurrent conflict', 409) } })
  conflict.state.edit(); conflict.state.draft.value += '# mine\n'; await conflict.state.review(); await conflict.state.apply()
  check('并发错误保留草稿并阻止重复提交', conflict.state.conflict.value && conflict.state.draft.value.includes('# mine') && !conflict.state.canApply.value)
  await conflict.state.reload()
  check('重新读取恢复当前资源及只读状态', conflict.calls.length === 1 && conflict.state.mode.value === 'read' && !conflict.state.conflict.value)
  let reads = 0
  const readFailure = harness({ get: async () => { if (++reads === 1) throw new Error('read unavailable'); return updated } })
  readFailure.state.edit(); readFailure.state.draft.value += '# saved\n'; await readFailure.state.review(); await readFailure.state.apply()
  check('成功提交但读回失败明确告知并保留草稿', readFailure.state.error.value.includes('修改已提交') && readFailure.state.conflict.value && readFailure.state.dirty.value)
  await readFailure.state.reload()
  check('提交后的读回失败可恢复', readFailure.state.mode.value === 'read' && reads === 2)
  const failure = harness({ dryRun: async () => { throw new Error('validation offline') } })
  failure.state.edit(); failure.state.draft.value += '# keep\n'; await failure.state.review()
  check('校验失败保留草稿供重试', failure.state.dirty.value && failure.state.error.value === 'validation offline' && !failure.state.checking.value)
  const disposed = deferred(), exiting = harness({ dryRun: () => disposed.promise })
  exiting.state.edit(); exiting.state.draft.value += '# leaving\n'; const late = exiting.state.review(); exiting.scope.stop()
  disposed.resolve({ valid: true, documents: [] }); await late
  check('组件销毁后不接受校验结果', exiting.state.mode.value === 'edit' && !exiting.state.canApply.value)
  console.log(`PASS ${count} resource Manifest checks; local Mock only`)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
