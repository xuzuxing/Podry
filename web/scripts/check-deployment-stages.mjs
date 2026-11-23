// 部署前后阶段设置的本地保存验证；不执行任务或部署。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
async function rejects(name, promise, pattern) { await assert.rejects(promise, pattern); count++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const db = await server.ssrLoadModule('/src/mock/data.ts')
  const { deploymentStageOf } = await server.ssrLoadModule('/src/utils/deploymentStage.ts')
  const appId = 'a-checkout'
  let wf = await api.getWorkflow(appId)
  const dev = wf.items.find(item => item.bindingId === 'b-checkout-dev')
  const prod = wf.items.find(item => item.bindingId === 'b-checkout-prod')
  const current = id => wf.items.find(item => item.id === id).definition
  const save = (id, patch) => api.saveWorkflow(appId, { version: wf.version, items: wf.items.map(item => item.id === id ? { ...item, definition: { ...item.definition, ...patch } } : item) })
  check('旧前置阶段默认自动触发且在默认环境执行', JSON.stringify(deploymentStageOf(current(dev.id), 'pre')) === JSON.stringify({ trigger: 'auto', runInEnvironment: false }))
  check('旧后置阶段独立兼容默认值', deploymentStageOf(current(dev.id), 'post').trigger === 'auto')
  check('开发环境显式启用 worker', (await api.listStageResources(appId,dev.bindingId)).workerEnabled === true)
  check('生产环境显式禁用 worker', (await api.listStageResources(appId,prod.bindingId)).workerEnabled === false)
  const cluster = db.clusters.find(item => item.id === 'c-dev')
  cluster.connectionStatus = 'disconnected'
  check('worker 能力不从连接状态推断', (await api.listStageResources(appId,dev.bindingId)).workerEnabled === true)
  cluster.connectionStatus = 'connected'
  wf = await save(dev.id,{ preStageTrigger: 'manual', postStageTrigger: 'auto', runPreStageInEnv: true, runPostStageInEnv: false, triggerMode: 'manual' })
  check('前后触发设置各自回读', current(dev.id).preStageTrigger === 'manual' && current(dev.id).postStageTrigger === 'auto')
  check('前后执行环境各自回读', current(dev.id).runPreStageInEnv && !current(dev.id).runPostStageInEnv)
  check('部署主阶段独立保存', current(dev.id).triggerMode === 'manual')
  check('其他环境未被修改', current(prod.id).preStageTrigger === undefined && current(prod.id).runPreStageInEnv === undefined)
  wf = await save(dev.id,{ preStageTrigger: 'auto', postStageTrigger: 'manual', runPreStageInEnv: false, runPostStageInEnv: true })
  check('可切换前后阶段设置且保留主阶段', !current(dev.id).runPreStageInEnv && current(dev.id).runPostStageInEnv && current(dev.id).triggerMode === 'manual')
  for (const [key, value] of [['preStageTrigger','unknown'],['postStageTrigger','on_ci_success'],['preStageTrigger',null],['runPreStageInEnv','true'],['runPostStageInEnv',1],['runPostStageInEnv',null]]) {
    await rejects(`拒绝无效 ${key}=${value}`, save(dev.id,{[key]:value}), /自动或手动|布尔值/)
  }
  await rejects('不支持 worker 的环境拒绝前置执行', save(prod.id,{runPreStageInEnv:true}), /前置阶段.*未配置部署 worker/)
  await rejects('不支持 worker 的环境拒绝后置执行', save(prod.id,{runPostStageInEnv:true}), /后置阶段.*未配置部署 worker/)
  wf = await save(prod.id,{preStageTrigger:'manual',postStageTrigger:'manual',runPreStageInEnv:false,runPostStageInEnv:false})
  check('worker 不可用仍允许修改阶段触发', current(prod.id).preStageTrigger === 'manual' && current(prod.id).postStageTrigger === 'manual')
  cluster.cdWorkerEnabled = false
  await rejects('worker 被关闭后拒绝沿用已启用执行环境', save(dev.id,{}), /后置阶段.*未配置部署 worker/)
  check('拒绝保存后仍保留原已存开关', (await api.getWorkflow(appId)).items.find(item=>item.id===dev.id).definition.runPostStageInEnv === true)
  wf = await save(dev.id,{runPostStageInEnv:false})
  check('明确关闭失效选择后可保存', current(dev.id).runPostStageInEnv === false)
  cluster.cdWorkerEnabled = undefined
  check('缺失 worker 元数据按不可用处理', (await api.listStageResources(appId,dev.bindingId)).workerEnabled === false)
  cluster.cdWorkerEnabled = true
  const snapshot = await api.getWorkflow(appId)
  snapshot.items.find(item=>item.id===dev.id).definition.preStageTrigger = 'manual'
  check('读取副本不能污染保存记录', (await api.getWorkflow(appId)).items.find(item=>item.id===dev.id).definition.preStageTrigger === 'auto')
  await rejects('旧工作流版本仍阻止覆盖', api.saveWorkflow(appId,{...wf,version:wf.version-1}), /配置已更新/)
  await rejects('跨应用绑定仍被拒绝', api.listStageResources('a-payment',dev.bindingId), /绑定不存在/)
  console.log(`Completed ${count} deployment stage Mock checks`)
} finally { await server.close() }
