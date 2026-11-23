// 本地 Mock 数据校验；不执行 Helm 或 Kubernetes 请求。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({server:{middlewareMode:true},appType:'custom'})
let checks=0
function check(name,value){assert.ok(value,name);checks++;console.log('PASS '+name)}
try{
  const api=await server.ssrLoadModule('/src/api/index.ts')
  const utils=await server.ssrLoadModule('/src/utils/configEntries.ts')
  const old=await api.getDeployment('d-checkout-dev-1')
  const base=(await api.listConfigMaps('a-checkout',null))[0]
  const own=(await api.listConfigMaps('a-checkout','e-dev'))[0]
  check('Patch 合并基础键与环境差异',utils.effectiveEntries([base],[own])[0].data.CURRENCY==='CNY')
  check('Replace 仅采用完整覆盖',!('CURRENCY' in utils.effectiveEntries([base],[{...own,mergeStrategy:'replace'}])[0].data))
  const changed=await api.saveConfigMap({...base,data:{LOG_LEVEL:'trace',CURRENCY:'USD'},dataYaml:'# preserved\nLOG_LEVEL: trace\nCURRENCY: USD\n',mountAs:'volume',mountPath:'/etc/config',subPath:true,fileMode:'0640'})
  check('YAML 原文和挂载参数保存',changed.dataYaml.startsWith('# preserved')&&changed.fileMode==='0640')
  await assert.rejects(api.saveConfigMap({...changed,environmentId:'e-prod'}),/配置不存在/);checks++
  await assert.rejects(api.saveConfigMap({...changed,name:'renamed'}),/名称不可修改/);checks++
  await assert.rejects(api.saveConfigMap({...changed,dataYaml:'x: true'}),/字符串/);checks++
  await assert.rejects(api.saveSecret({appId:'a-checkout',environmentId:null,name:'duplicate-keys',keys:['KEY','KEY']}),/重复项/);checks++
  check('固定历史示例不受当前 ConfigMap 修改影响',(await api.getDeployment(old.id)).configSnapshot.configMaps[0].data.CURRENCY==='CNY')
  const cfg=await api.getConfig('a-checkout')
  const created=await api.confirmDeployment({previewId:'mock-preview',bindingId:'b-checkout-dev',artifactId:'ar-1011',imageRef:'example:v2',configVersion:cfg.version})
  check('新发布捕获合并后的 ConfigMap',created.configSnapshot.configMaps[0].data.LOG_LEVEL==='debug'&&created.configSnapshot.configMaps[0].data.CURRENCY==='USD')
  check('Patch 挂载设置继承基础配置',created.configSnapshot.configMaps[0].mountPath==='/etc/config')
  await api.saveConfigMap({...changed,data:{LOG_LEVEL:'info'},dataYaml:undefined})
  check('新发布快照不跟随后续修改',(await api.getDeployment(created.id)).configSnapshot.configMaps[0].data.CURRENCY==='USD')
  created.configSnapshot.configMaps[0].data.CURRENCY='mutated-client'
  check('API 返回快照为独立副本',(await api.getDeployment(created.id)).configSnapshot.configMaps[0].data.CURRENCY==='USD')
  const rollback=await api.rollbackDeployment(old.id,'Mock snapshot verification')
  check('回滚沿用来源发布快照',JSON.stringify(rollback.configSnapshot)===JSON.stringify(old.configSnapshot))
  const promotion=await api.promoteDeployment(old.id,'b-checkout-prod')
  check('晋级捕获目标环境配置而非复制来源快照',promotion.configSnapshot.target.namespace==='shop-prod'&&promotion.configSnapshot.configMaps[0].data.LOG_LEVEL==='warn')
  const secret=await api.saveSecret({appId:'a-checkout',environmentId:null,name:'snapshot-secret',keys:['TOKEN'],value:'do-not-persist',data:{TOKEN:'do-not-persist'}})
  check('Secret 不持久化额外明文字段',!JSON.stringify(secret).includes('do-not-persist')&&!('data' in secret))
  await api.deleteConfigMap(base.id)
  check('删除当前配置不删除历史快照',(await api.getDeployment(old.id)).configSnapshot.configMaps.length===1)
  check('无快照记录保持缺失状态',!(await api.getDeployment('d-payment-dev-1')).configSnapshot)
  await assert.rejects(api.confirmDeployment({bindingId:'b-checkout-dev',configVersion:-1}),/重新预览/);checks++
  console.log(`Completed ${checks} Mock snapshot/config checks`)
}finally{await server.close()}
