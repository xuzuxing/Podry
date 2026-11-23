// 本地示例清单、Chart 默认值及历史隔离；不运行 Helm/Kubernetes。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { parseAllDocuments } from 'yaml'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { resolveComparisonSide: resolve, comparisonVersionOptions: versions, comparisonEnvironmentOptions: environments, comparisonInitialVersion: initial, comparisonFiles: files } = await server.ssrLoadModule('/src/utils/configComparison.ts')
  const { resolveComparisonManifest: manifest } = await server.ssrLoadModule('/src/utils/configComparisonManifest.ts')
  const catalog = await api.getConfigComparisonCatalog('a-checkout')
  const side = (environment, version = 'saved', source = catalog) => resolve(source, { environment, version })
  const docs = result => parseAllDocuments(result.text).map(doc => { assert.equal(doc.errors.length, 0); return doc.toJS() })
  const resource = (result, kind) => docs(result).find(item => item.kind === kind)
  const saved = side('e-dev'), previous = side('e-dev', 'history:d-checkout-dev-1'), current = side('e-dev', 'deployed')
  const chartId = 'chart:Deployment:1.4.0', defaults = side(chartId, 'default')
  check('示例 Chart 目录包含模板选择器的两个版本', catalog.chartDefaults.length === 2 && catalog.chartDefaults.some(item => item.id === 'chart:Deployment:1.2.0'))
  check('环境选择器提供独立 Chart 默认入口', environments(catalog).some(item => item.value === chartId && item.label.includes('(Default)')))
  check('Chart 默认版本不混入应用发布历史', versions(catalog, chartId).length === 1 && versions(catalog, chartId)[0].value === 'default')
  check('切换 Chart 和普通环境各自使用有效版本', initial(chartId) === 'default' && initial('e-dev') === 'saved')
  check('Chart 默认不继承应用和环境的值', defaults.document.values.replicaCount === 1 && defaults.document.values.host === undefined && Object.keys(defaults.document.configmaps).length === 0)
  check('默认目录有本地示例来源说明', defaults.notice.includes('本地示例目录'))
  check('Chart 入口拒绝应用历史和已保存版本', side(chartId, 'history:d-checkout-dev-1').document === null && side(chartId).document === null)
  check('未知 Chart 保持不可用而不借用其他版本', side('chart:Deployment:9.9.9', 'default').document === null)
  check('默认值与应用配置的单侧文件保留删除标记', files(saved, defaults).some(item => item.type === 'configmaps' && item.removed))
  const defaultManifest = manifest(defaults), historical = manifest(previous), savedManifest = manifest(saved)
  check('生成有效多文档 YAML', docs(historical).length >= 3 && historical.error === '')
  check('生成清单展开标签而不引入 YAML 别名', !historical.text.includes('&a1') && !historical.text.includes('*a1'))
  check('历史镜像来自指定发布记录', resource(historical, 'Deployment').spec.template.spec.containers[0].image === catalog.deployments.find(item => item.id === previous.deploymentId).imageRef)
  check('历史目标使用当次快照', resource(historical, 'Deployment').metadata.namespace === 'shop-dev' && resource(historical, 'Deployment').metadata.name === 'checkout-api-dev')
  check('已保存配置明确镜像占位', resource(savedManifest, 'Deployment').spec.template.spec.containers[0].image === '<IMAGE>' && savedManifest.notice.includes('占位'))
  check('基础配置和默认值不臆造 Namespace', !('namespace' in resource(defaultManifest, 'Deployment').metadata) && !('namespace' in resource(manifest(side('base')), 'Deployment').metadata))
  check('历史 ConfigMap 展示当次值', resource(historical, 'ConfigMap').data.CACHE_TTL_SECONDS === '30' && resource(manifest(current), 'ConfigMap').data.CACHE_TTL_SECONDS === '60')
  check('工作负载生成 ConfigMap 和 Secret 环境引用', resource(historical, 'Deployment').spec.template.spec.containers[0].envFrom.length === 2)
  check('Secret 仅展示键和遮蔽值', Object.values(resource(historical, 'Secret').stringData).every(value => value === '••••••'))
  check('声明本地预览及 Secret 相等边界', historical.text.includes('未执行 Helm') && historical.text.includes('不能据此判断明文相同'))
  check('host 示例映射生成配套 Service/Ingress', resource(historical, 'Service').spec.ports[0].targetPort === 'http' && resource(historical, 'Ingress').spec.rules[0].host === 'checkout.acme.dev')
  check('Chart 默认无应用配置清单', docs(defaultManifest).length === 1)
  const poisoned = structuredClone(catalog)
  const record = poisoned.deployments.find(item => item.id === previous.deploymentId)
  record.configSnapshot.secrets[0].data = { DB_PASSWORD: 'private-value' }
  record.configSnapshot.secrets[0].stringData = { API_TOKEN: 'private-token' }
  check('旧快照额外 Secret 字段不进入清单', !manifest(side('e-dev', 'history:' + previous.deploymentId, poisoned)).text.includes('private-'))
  const external = structuredClone(previous)
  external.document.configmaps['checkout-api-config'].source = 'external'
  const externalResult = manifest(external)
  check('外部配置仅生成引用而不创建资源', !docs(externalResult).some(item => item.kind === 'ConfigMap') && externalResult.text.includes('configMapRef:'))
  const volume = structuredClone(previous)
  Object.assign(volume.document.configmaps['checkout-api-config'], { mountAs: 'volume', mountPath: '/etc/config/', subPath: true, fileMode: '0640' })
  const mounted = resource(manifest(volume), 'Deployment').spec.template.spec
  check('卷挂载转换八进制文件权限', mounted.volumes[0].configMap.defaultMode === 416)
  check('SubPath 按键生成只读文件挂载', mounted.containers[0].volumeMounts.length === 3 && mounted.containers[0].volumeMounts.some(item => item.mountPath === '/etc/config/LOG_LEVEL' && item.subPath === 'LOG_LEVEL' && item.readOnly))
  const invalidVolume = structuredClone(volume)
  invalidVolume.document.configmaps['checkout-api-config'].mountPath = 'relative'
  check('非法挂载路径不产生部分清单', manifest(invalidVolume).error.includes('挂载路径') && manifest(invalidVolume).text === '')
  invalidVolume.document.configmaps['checkout-api-config'].mountPath = '/etc'
  invalidVolume.document.configmaps['checkout-api-config'].fileMode = '0999'
  check('非法权限不伪造有效清单', !!manifest(invalidVolume).error)
  const unsupported = structuredClone(previous)
  unsupported.document.values.resources = { limits: { cpu: '1' } }
  check('未支持字段明确报错而不静默丢弃', manifest(unsupported).error.includes('resources') && manifest(unsupported).text === '')
  for (const [key, value] of [['replicaCount', -1], ['replicaCount', '2'], ['containerPort', 65536], ['env', { COUNT: 1 }], ['job', { unknown: 1 }], ['job', { backoffLimit: -1 }], ['job', { activeDeadlineSeconds: 0 }]]) {
    const invalid = structuredClone(previous); invalid.document.values[key] = value
    check('非法 Values 不生成清单 ' + key + ':' + JSON.stringify(value), manifest(invalid).text === '' && !!manifest(invalid).error)
  }
  const unsupportedChart = structuredClone(previous)
  unsupportedChart.manifestContext.chartConfig.chartVersion = '9.9.9'
  check('未支持 Chart 版本明确不可用', manifest(unsupportedChart).error.includes('Chart'))
  const missingChart = structuredClone(previous); missingChart.manifestContext.chartConfig = null
  check('缺 Chart 不借用当前 Chart', manifest(missingChart).error.includes('尚未配置'))
  const missingImage = structuredClone(previous); missingImage.manifestContext.imageRef = null
  check('缺历史镜像不能改用占位镜像', manifest(missingImage).error.includes('缺少目标或镜像'))
  check('缺历史快照保留原始错误', manifest(side('e-staging', 'deployed')).error.includes('未保存配置快照'))
  check('跨环境历史没有清单', manifest(side('e-prod', 'history:' + previous.deploymentId)).text === '')
  const missingTarget = structuredClone(catalog)
  delete missingTarget.deployments.find(item => item.id === previous.deploymentId).configSnapshot.target
  check('缺历史目标不抛异常或借用当前目标', manifest(side('e-dev', 'history:' + previous.deploymentId, missingTarget)).error.includes('缺少目标或镜像'))
  const jobCatalog = await api.getConfigComparisonCatalog('a-metrics')
  check('Job 应用提供独立的默认 Chart 目录', jobCatalog.chartDefaults.every(item => item.chartConfig.workloadKind === 'Job'))
  const jobSide = side('chart:Job:1.2.0', 'default', jobCatalog)
  jobSide.document.values = { env: { MODE: 'batch' }, job: { backoffLimit: 0, activeDeadlineSeconds: 120 } }
  const jobManifest = resource(manifest(jobSide), 'Job')
  check('Job 输出独立的 batch 结构及零次重试', jobManifest.apiVersion === 'batch/v1' && jobManifest.spec.backoffLimit === 0 && jobManifest.spec.template.spec.restartPolicy === 'Never' && !('replicas' in jobManifest.spec))
  check('Job 清单不会生成 Deployment 端口', !('ports' in jobManifest.spec.template.spec.containers[0]))
  const zero = structuredClone(saved); zero.document.values.replicaCount = 0
  check('零副本不被默认值覆盖', resource(manifest(zero), 'Deployment').spec.replicas === 0)
  const reordered = structuredClone(previous)
  reordered.document.values = Object.fromEntries(Object.entries(reordered.document.values).reverse())
  reordered.document.configmaps['checkout-api-config'].data = Object.fromEntries(Object.entries(reordered.document.configmaps['checkout-api-config'].data).reverse())
  check('对象键顺序不制造清单差异', manifest(reordered).text === historical.text)
  const isolated = side('e-dev', 'history:' + previous.deploymentId)
  isolated.manifestContext.chartConfig.chartVersion = 'mutated'; isolated.manifestContext.target.namespace = 'mutated'
  check('返回的历史上下文深副本不污染目录', manifest(side('e-dev', 'history:' + previous.deploymentId)).text === historical.text)
  catalog.config.deployValues.replicaCount = 99; catalog.config.chartConfig.chartVersion = '9.9.9'; catalog.bindings[0].target.namespace = 'changed'
  check('修改当前值 Chart 及目标不污染历史清单', manifest(side('e-dev', 'history:' + previous.deploymentId)).text === historical.text)
  const fresh = await api.getConfigComparisonCatalog('a-checkout')
  fresh.chartDefaults[0].values.replicaCount = 999
  check('Chart 默认目录每次读取独立副本', (await api.getConfigComparisonCatalog('a-checkout')).chartDefaults[0].values.replicaCount === 1)
  check('读取和渲染不会修改之前的输出', historical.text === manifest(previous).text)
  console.log(`Completed ${count} config manifest Mock checks`)
} finally { await server.close() }
