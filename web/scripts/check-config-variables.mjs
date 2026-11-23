// 仅验证本地 Mock 解析与历史隔离，不调用 Devtron/Kubernetes。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const db = await server.ssrLoadModule('/src/mock/data.ts')
  const { captureConfigVariables: capture, hasScopedVariables: has, resolveVariableSide: convert } = await server.ssrLoadModule('/src/utils/configVariables.ts')
  const { resolveComparisonSide: resolve, comparisonFiles: files } = await server.ssrLoadModule('/src/utils/configComparison.ts')
  const { resolveComparisonManifest: manifest } = await server.ssrLoadModule('/src/utils/configComparisonManifest.ts')
  const { captureDeploymentConfig } = await server.ssrLoadModule('/src/utils/deploymentSnapshot.ts')
  const catalog = await api.getConfigComparisonCatalog('a-payment')
  const side = (environment, version = 'saved', source = catalog) => resolve(source, { environment, version })
  const dev = side('e-dev'), prod = side('e-prod'), history = side('e-dev', 'history:d-payment-dev-scoped')
  check('原始部署配置保留变量引用', dev.document.values.env.REGION === '@{{payment-region}}')
  check('配置编辑源与对比源一致', catalog.config.deployValues.env.REGION === dev.document.values.env.REGION && catalog.configMaps[0].data.QUEUE_NAME === dev.document.configmaps['payment-worker-config'].data.QUEUE_NAME)
  check('配置目录提供独立环境解析回执', dev.variableSnapshot !== prod.variableSnapshot && !!dev.variableSnapshot.resolved)
  check('关闭转换不改变原始配置', convert(dev, false) === dev)
  const resolvedDev = convert(dev, true), resolvedProd = convert(prod, true), resolvedHistory = convert(history, true)
  check('开发环境解析部署变量', resolvedDev.document.values.env.REGION === 'cn-hangzhou')
  check('生产环境解析不同变量', resolvedProd.document.values.env.REGION === 'cn-shanghai')
  check('ConfigMap 使用对应环境解析值', resolvedDev.document.configmaps['payment-worker-config'].data.QUEUE_NAME === 'payments-dev' && resolvedProd.document.configmaps['payment-worker-config'].data.QUEUE_NAME === 'payments-prod')
  check('原始相同配置不产生变量值差异', files(dev, prod).every(item => !item.changed))
  check('转换后重新计算部署和文件差异', files(resolvedDev, resolvedProd).filter(item => item.changed).length === 2)
  check('变量名列表不混入无关变量', dev.variableSnapshot.variableNames.join(',') === 'payment-queue,payment-region')
  check('历史独立保存旧解析值', resolvedHistory.document.values.env.REGION === 'cn-beijing' && resolvedHistory.document.configmaps['payment-worker-config'].data.QUEUE_NAME === 'payments-legacy')
  check('旧缺快照记录继续缺失', side('e-dev', 'history:d-payment-dev-1').error.includes('未保存配置快照'))
  const missing = structuredClone(history); delete missing.variableSnapshot
  check('历史缺解析快照不可使用当前变量回填', convert(missing, true).document === null && convert(missing, true).error.includes('未保存变量解析快照'))
  check('缺解析快照仍可查看原始变量', convert(missing, false).document.values.env.REGION === '@{{payment-region}}')
  const stale = structuredClone(history); stale.document.values.containerPort = 8080
  check('原始文档变动使历史解析回执失效', convert(stale, true).document === null && convert(stale, true).error.includes('不匹配'))
  const reordered = structuredClone(dev); reordered.document.values = Object.fromEntries(Object.entries(reordered.document.values).reverse())
  check('对象键顺序不导致快照失效', !convert(reordered, true).error)
  const secret = structuredClone(dev)
  secret.variableSnapshot.resolved.secrets = { leaked: { data: { PASSWORD: 'never-show-this' } } }
  check('回执额外 Secret 字段不覆盖遮蔽文档', !JSON.stringify(convert(secret, true).document).includes('never-show-this'))
  check('Secret 保留遮蔽值', resolvedDev.document.secrets['payment-worker-secret'].data.DB_PASSWORD === '••••••')
  check('解析回执排除所有 Secret', !('secrets' in dev.variableSnapshot.source) && !('secrets' in dev.variableSnapshot.resolved))
  const unknown = structuredClone(dev.document); unknown.values.env.REGION = '@{{unknown-variable}}'
  const unknownReceipt = capture(unknown, {})
  check('未知变量不返回部分结果', unknownReceipt.resolved === null && unknownReceipt.error.includes('unknown-variable'))
  check('解析失败时可恢复原始查看', convert({ ...dev, document: unknown, variableSnapshot: unknownReceipt }, true).document === null && convert({ ...dev, document: unknown, variableSnapshot: unknownReceipt }, true).notice === '' && !!convert({ ...dev, document: unknown, variableSnapshot: unknownReceipt }, false).document)
  const expression = structuredClone(dev.document); expression.values.env.REGION = '@{{process.exit()}}'
  check('表达式不执行并保持解析失败', capture(expression, {}).resolved === null)
  const nested = structuredClone(dev.document); nested.values.env.REGION = '@{{payment-region}}'
  check('变量不递归执行', capture(nested, { 'payment-region': '@{{payment-queue}}', 'payment-queue': 'wrong' }).resolved === null)
  const embedded = structuredClone(dev.document); embedded.values.env.REGION = 'region=@{{payment-region}}'
  const literal = capture(embedded, { 'payment-region': '$& \\ path\nline', 'payment-queue': 'queue' })
  check('嵌入变量使用字面替换保留换行和特殊字符', literal.resolved.values.env.REGION === 'region=$& \\ path\nline')
  const array = structuredClone(dev.document); array.values.array = ['@{{payment-region}}', false, 42, null]
  check('数组内变量解析且保留其他类型', capture(array, { 'payment-region': 'region', 'payment-queue': 'queue' }).resolved.values.array[2] === 42)
  const noVariables = { values: { number: 42 }, configmaps: {}, secrets: { secret: { data: { KEY: '@{{secret-key}}' } } } }
  check('无非 Secret 引用时不显示解析入口', !has(noVariables) && capture(noVariables, {}) === undefined)
  check('缺文档不触发解析', !has(null) && convert({ label: '', document: null, error: 'missing', notice: '' }, true).error === 'missing')
  const deployment = manifest(resolvedHistory)
  check('历史 Manifest 使用旧解析值', !deployment.error && deployment.text.includes('cn-beijing') && deployment.text.includes('payments-legacy') && !deployment.text.includes('@{{'))
  check('缺解析快照不会生成假 Manifest', manifest(convert(missing, true)).text === '')
  resolvedDev.document.values.env.REGION = 'mutated-client'
  check('转换返回文档可修改且不污染解析回执', convert(dev, true).document.values.env.REGION === 'cn-hangzhou')
  const fresh = await api.getConfigComparisonCatalog('a-payment'); fresh.variableSnapshots['e-dev'].resolved.values.env.REGION = 'client'
  check('目录 API 解析回执深副本隔离', (await api.getConfigComparisonCatalog('a-payment')).variableSnapshots['e-dev'].resolved.values.env.REGION === 'cn-hangzhou')
  const binding = catalog.bindings.find(item => item.environmentId === 'e-dev')
  const captured = captureDeploymentConfig(catalog.config, binding, catalog.configMaps, catalog.secrets, { 'payment-region': 'captured-region', 'payment-queue': 'captured-queue' })
  check('发布捕获当次原始配置和解析结果', captured.values.env.REGION === '@{{payment-region}}' && captured.variableSnapshot.resolved.values.env.REGION === 'captured-region')
  const created = await api.confirmDeployment({ previewId: 'mock-preview', bindingId: binding.id, artifactId: 'ar-899', imageRef: 'example:v1', configVersion: catalog.config.version })
  check('Mock 发布入口保存变量解析快照', created.configSnapshot.variableSnapshot.resolved.values.env.REGION === 'cn-hangzhou')
  const rolledBack = await api.rollbackDeployment(created.id, 'Mock variable snapshot check')
  check('回滚完整沿用来源解析快照', JSON.stringify(rolledBack.configSnapshot.variableSnapshot) === JSON.stringify(created.configSnapshot.variableSnapshot))
  const promoted = await api.promoteDeployment(created.id, 'b-payment-prod')
  check('晋级捕获目标环境变量而非来源解析值', promoted.configSnapshot.variableSnapshot.resolved.values.env.REGION === 'cn-shanghai')
  db.appConfigs['a-payment'].deployValues.env.REGION = 'edited-after-deploy'
  check('后续源配置修改不污染历史回执', (await api.getDeployment(created.id)).configSnapshot.variableSnapshot.resolved.values.env.REGION === 'cn-hangzhou')
  check('已加载目录和原始配置保持隔离', dev.document.values.env.REGION === '@{{payment-region}}')
  const checkout = await api.getConfigComparisonCatalog('a-checkout')
  check('无变量应用不制造解析回执', Object.keys(checkout.variableSnapshots).length === 0)
  console.log(`Completed ${count} scoped variable Mock checks`)
} finally { await server.close() }
