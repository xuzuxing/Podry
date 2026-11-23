// 前端 Mock 保存边界和任务依赖验证；不执行脚本或插件。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
let count=0
function check(name,value){assert.ok(value,name);count++;console.log('PASS '+name)}
async function rejects(name,promise,pattern){await assert.rejects(promise,pattern);count++;console.log('PASS '+name)}
try {
  const api=await server.ssrLoadModule('/src/api/index.ts')
  const {createTask,applyTaskPlugin,taskCatalog}=await server.ssrLoadModule('/src/mock/taskCatalog.ts')
  const {copyTasks,validatePipelineTasks}=await server.ssrLoadModule('/src/utils/pipelineTasks.ts')
  const appId='a-checkout'
  let wf=await api.getWorkflow(appId)
  const pipeline=wf.items.find(item=>item.kind==='ci')
  const producer={...createTask('shell',0),id:'producer',name:'Produce',outputs:[{key:'SCORE',format:'number'}]}
  const consumer={...createTask('shell',1),id:'consumer',name:'Consume',variables:[{key:'SCORE',format:'number',source:'task',refTaskId:'producer',refVariable:'SCORE',value:''}],triggerRule:{mode:'trigger',conditions:[{id:'c1',variable:'SCORE',operator:'>=',value:'80'}]},outputs:[{key:'OK',format:'boolean'}],resultRule:{mode:'pass',conditions:[{id:'c2',variable:'OK',operator:'==',value:'true'}]}}
  const save=(pre,post=[])=>api.saveWorkflow(appId,{version:wf.version,items:wf.items.map(item=>item.id===pipeline.id?{...item,definition:{...item.definition,preTasks:pre,postTasks:post}}:item)})
  wf=await save([producer],[consumer])
  check('前置输出可供后置任务引用',wf.items.find(item=>item.id===pipeline.id).definition.postTasks[0].variables[0].refTaskId==='producer')
  check('条件保存回读',wf.items.find(item=>item.id===pipeline.id).definition.postTasks[0].resultRule.conditions[0].value==='true')
  const clone=copyTasks([consumer]);clone[0].triggerRule.conditions[0].value='1';clone[0].outputs[0].key='CHANGED'
  check('编辑副本隔离嵌套条件和输出',consumer.triggerRule.conditions[0].value==='80' && consumer.outputs[0].key==='OK')
  await rejects('拒绝前向依赖',save([consumer,producer]),/前序任务输出不可用/)
  await rejects('拒绝删除仍被引用的任务',save([],[consumer]),/前序任务输出不可用/)
  await rejects('拒绝移动后失效的引用',save([consumer],[producer]),/前序任务输出不可用/)
  await rejects('拒绝输入输出类型不匹配',save([producer],[{...consumer,variables:[{...consumer.variables[0],format:'string'}]}]),/类型不匹配/)
  await rejects('拒绝未定义的条件变量',save([producer],[{...consumer,resultRule:{...consumer.resultRule,conditions:[{...consumer.resultRule.conditions[0],variable:'MISSING'}]}}]),/变量不存在/)
  await rejects('拒绝无效数字',save([{...producer,variables:[{key:'COUNT',format:'number',value:'many'}]}]),/Number/)
  await rejects('拒绝无效布尔值',save([{...producer,variables:[{key:'FLAG',format:'boolean',value:'yes'}]}]),/true 或 false/)
  await rejects('拒绝无效日期',save([{...producer,variables:[{key:'DAY',format:'date',value:'yesterday'}]}]),/有效日期/)
  await rejects('拒绝不存在的日期',save([{...producer,variables:[{key:'DAY',format:'date',value:'2026-02-30'}]}]),/有效日期/)
  await rejects('拒绝不存在的全局变量',save([{...producer,variables:[{key:'APP',source:'global',value:'MISSING'}]}]),/全局变量不可用/)
  await rejects('拒绝重复变量名',save([{...producer,variables:[{key:'APP',value:'a'},{key:'APP',value:'b'}]}]),/不能重复/)
  await rejects('拒绝重复任务标识',save([producer,producer]),/标识不能重复/)
  await rejects('拒绝 String 大小运算符',save([{...producer,variables:[{key:'APP',value:'a'}],triggerRule:{mode:'skip',conditions:[{id:'s',variable:'APP',operator:'>',value:'b'}]}}]),/只支持/)
  await rejects('拒绝 Container 脚本输出变量',save([{...producer,execution:'container',image:'alpine:latest'}]),/不支持脚本输出/)
  await rejects('拒绝 Container 缺少镜像',save([{...producer,execution:'container',outputs:[]}]),/Container image/)
  const valid={...producer,variables:[{key:'APP',source:'global',value:'APP_NAME',format:'string'},{key:'DAY',value:'2026-11-22',format:'date'}]}
  check('全局变量和有效日期可配置',!Object.keys(validatePipelineTasks([valid],[])).length)
  const plugin=taskCatalog[0]
  const latest=applyTaskPlugin(createTask('shell',0),plugin,plugin.versions[0])
  latest.variables[0].value='build'
  const older=applyTaskPlugin(latest,plugin,plugin.versions[1])
  check('切换版本保留同名同类型参数',older.variables[0].value==='build' && older.variables.length===1)
  wf=await save([older])
  check('插件版本保存回读',wf.items.find(item=>item.id===pipeline.id).definition.preTasks[0].plugin.version==='mock-v1')
  await rejects('拒绝不存在的插件版本',save([{...older,plugin:{...older.plugin,version:'missing'}}]),/版本不存在/)
  await rejects('拒绝擅自修改插件参数结构',save([{...older,variables:[]}]),/参数结构/)
  await rejects('拒绝擅自修改插件脚本',save([{...older,script:'echo changed'}]),/参数结构/)
  const result=await api.getWorkflow(appId);result.items.find(item=>item.id===pipeline.id).definition.preTasks[0].variables[0].value='mutated'
  check('Mock 返回值不污染保存记录',(await api.getWorkflow(appId)).items.find(item=>item.id===pipeline.id).definition.preTasks[0].variables[0].value==='build')
  console.log(`Completed ${count} Mock task checks`)
} finally {await server.close()}
