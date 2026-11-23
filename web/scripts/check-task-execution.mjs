// 容器表单与阶段配置引用的本地保存验证；不执行容器或脚本。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
async function rejects(name, promise, pattern) { await assert.rejects(promise, pattern); count++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { createTask } = await server.ssrLoadModule('/src/mock/taskCatalog.ts')
  const { copyTasks } = await server.ssrLoadModule('/src/utils/pipelineTasks.ts')
  const { containerConfigOf, outputPathsOf } = await server.ssrLoadModule('/src/utils/taskExecution.ts')
  const appId = 'a-checkout'
  let wf = await api.getWorkflow(appId)
  const ci = wf.items.find(item => item.kind === 'ci')
  const cd = wf.items.find(item => item.bindingId === 'b-checkout-dev')
  const save = (pipeline, patch) => api.saveWorkflow(appId, { version: wf.version, items: wf.items.map(item => item.id === pipeline.id ? { ...item, definition: { ...item.definition, ...patch } } : item) })
  const task = { ...createTask('container', 0), image: 'alpine:3.20', script: '' }
  wf = await save(ci, { preTasks: [task] })
  check('未挂载脚本的容器可使用镜像入口保存', wf.items.find(item => item.id === ci.id).definition.preTasks[0].script === '')
  const advanced = { ...task, script: '#!/bin/sh\necho done\n', outputDirectoryPaths: ['/reports','/artifacts'], container: {
    ...task.container, command: '/bin/sh', args: ['/tasks/run.sh','--report'], mountCustomScript: true, scriptMountPath: '/tasks/run.sh',
    ports: [{ hostPort: '18080', containerPort: '8080' }], mountSource: true, sourceMountPath: '/sourcecode',
    mountHost: true, hostPaths: [{ hostPath: '/tmp/reports', containerPath: '/reports' }],
  } }
  wf = await save(ci, { preTasks: [advanced] })
  const read = wf.items.find(item => item.id === ci.id).definition.preTasks[0]
  check('容器命令与参数逐项回读', read.container.command === '/bin/sh' && read.container.args[1] === '--report')
  check('脚本挂载路径回读', read.container.mountCustomScript && read.container.scriptMountPath === '/tasks/run.sh')
  check('端口与主机映射回读', read.container.ports[0].hostPort === '18080' && read.container.hostPaths[0].containerPath === '/reports')
  check('源码挂载开关与路径回读', read.container.mountSource && read.container.sourceMountPath === '/sourcecode')
  check('多个产物路径独立回读', outputPathsOf(read).join('|') === '/reports|/artifacts')
  const copied = copyTasks([read]); copied[0].container.ports[0].hostPort = '1'; copied[0].outputDirectoryPaths[0] = '/changed'
  check('任务嵌套副本隔离', read.container.ports[0].hostPort === '18080' && read.outputDirectoryPaths[0] === '/reports')
  const badContainer = patch => save(ci, { preTasks: [{ ...advanced, container: { ...advanced.container, ...patch } }] })
  await rejects('挂载脚本时拒绝空脚本', save(ci, { preTasks: [{ ...advanced, script: '' }] }), /填写任务脚本/)
  await rejects('拒绝相对脚本挂载路径', badContainer({ scriptMountPath: 'run.sh' }), /绝对文件路径/)
  await rejects('脚本挂载路径不能是目录', badContainer({ scriptMountPath: '/scripts/' }), /绝对文件路径/)
  await rejects('拒绝不完整端口映射', badContainer({ ports: [{ hostPort: '8080', containerPort: '' }] }), /1–65535/)
  await rejects('拒绝端口超出范围', badContainer({ ports: [{ hostPort: '65536', containerPort: '8080' }] }), /1–65535/)
  await rejects('拒绝端口小数', badContainer({ ports: [{ hostPort: '80.5', containerPort: '8080' }] }), /1–65535/)
  await rejects('拒绝重复主机端口', badContainer({ ports: [{ hostPort: '80', containerPort: '8080' }, { hostPort: '080', containerPort: '8081' }] }), /不能重复/)
  await rejects('拒绝缺失源码挂载路径', badContainer({ sourceMountPath: '' }), /源码挂载目录/)
  await rejects('主机映射开启时至少一行', badContainer({ hostPaths: [] }), /至少添加一条/)
  await rejects('拒绝缺失主机目录', badContainer({ hostPaths: [{ hostPath: '', containerPath: '/data' }] }), /主机和容器路径/)
  await rejects('拒绝空参数项', badContainer({ args: ['-c',''] }), /空参数/)
  await rejects('拒绝空产物路径', save(ci, { preTasks: [{ ...advanced, outputDirectoryPaths: [''] }] }), /产物路径/)
  await rejects('拒绝保留目录产物路径', save(ci, { preTasks: [{ ...advanced, outputDirectoryPaths: ['/devtroncd/reports'] }] }), /保留目录/)
  wf = await badContainer({ mountSource: false, sourceMountPath: '', mountHost: false, hostPaths: [{ hostPath: '', containerPath: '' }], mountCustomScript: false, scriptMountPath: '' })
  check('关闭挂载后不校验隐藏字段', wf.version > 0)
  const legacy = { ...task, container: undefined, script: 'echo legacy', artifactPaths: 'reports/**, coverage' }
  check('旧容器脚本兼容映射保留语义', containerConfigOf(legacy).mountCustomScript && containerConfigOf(legacy).args[0] === '/script.sh')
  check('旧产物逗号列表兼容回读', outputPathsOf(legacy).length === 2)
  const resources = await api.listStageResources(appId, cd.bindingId)
  check('同名基础和环境覆盖只出现一次', resources.options.filter(item => item.kind === 'configMaps' && item.name === 'checkout-api-config').length === 1)
  check('标记有效覆盖和继承来源', resources.options.some(item => item.kind === 'configMaps' && !item.inherited) && resources.options.some(item => item.kind === 'secrets' && item.inherited))
  check('引用选项只含名称类型元数据', resources.options.every(item => Object.keys(item).sort().join(',') === 'inherited,kind,name'))
  await rejects('拒绝读取其他应用的环境绑定', api.listStageResources('a-payment', cd.bindingId), /绑定不存在/)
  const refs = { configMaps: ['checkout-api-config'], secrets: ['checkout-api-secret'] }
  wf = await save(cd, { preStageResources: refs, postStageResources: { configMaps: [], secrets: ['checkout-api-secret'] } })
  let definition = wf.items.find(item => item.id === cd.id).definition
  check('前后阶段引用独立保存', definition.preStageResources.configMaps.length === 1 && definition.postStageResources.configMaps.length === 0)
  await rejects('引用不能把 Secret 当作 ConfigMap', save(cd, { preStageResources: { configMaps: ['checkout-api-secret'], secrets: [] } }), /已不可用/)
  await rejects('拒绝重复配置引用', save(cd, { preStageResources: { configMaps: ['checkout-api-config','checkout-api-config'], secrets: [] } }), /不能重复/)
  const own = await api.saveConfigMap({ appId, environmentId: 'e-dev', name: 'stage-dev-only', data: { MODE: 'dev' } })
  const prod = wf.items.find(item => item.bindingId === 'b-checkout-prod')
  await rejects('目标环境隔离其他环境专属配置', save(prod, { preStageResources: { configMaps: [own.name], secrets: [] } }), /已不可用/)
  wf = await save(cd, { preStageResources: { configMaps: [own.name], secrets: [] } })
  await api.deleteConfigMap(own.id)
  await rejects('删除后的阶段配置引用阻止保存', save(cd, {}), /已不可用/)
  wf = await save(cd, { preStageResources: refs })
  const override = (await api.listConfigMaps(appId,'e-dev')).find(item => item.name === 'checkout-api-config')
  await api.deleteConfigMap(override.id)
  wf = await save(cd, {})
  check('移除环境覆盖后名称引用回落基础配置', (await api.listStageResources(appId,cd.bindingId)).options.some(item => item.name === 'checkout-api-config' && item.inherited))
  const snapshot = await api.getWorkflow(appId); snapshot.items.find(item => item.id === cd.id).definition.preStageResources.secrets.length = 0
  definition = (await api.getWorkflow(appId)).items.find(item => item.id === cd.id).definition
  check('引用返回值与保存记录隔离', definition.preStageResources.secrets[0] === 'checkout-api-secret')
  check('保存引用不包含 Secret 数据', !JSON.stringify(definition).includes('DB_PASSWORD'))
  console.log(`Completed ${count} task execution and stage resource Mock checks`)
} finally { await server.close() }
