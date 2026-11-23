// Local frontend validators, clone list paging, and Mock creation boundaries.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
let count=0
function check(name,value){assert.ok(value,name);count++;console.log('PASS '+name)}
async function rejects(name,action,pattern){await assert.rejects(action,pattern);count++;console.log('PASS '+name)}
try{
  const utils=await server.ssrLoadModule('/src/utils/applicationCreation.ts')
  const {readApplicationCloneSources:collect}=await server.ssrLoadModule('/src/utils/applicationCloneSources.ts')
  const api=await server.ssrLoadModule('/src/api/index.ts')
  const db=await server.ssrLoadModule('/src/mock/data.ts')
  for(const name of ['api','abc-123','a'.repeat(30)])check('有效应用名 '+name,!utils.applicationNameError(name))
  for(const name of ['', 'ab','123','Uppercase','white space','bad_underscore','-leading','trailing-','a'.repeat(31),' api'])check('无效应用名 '+JSON.stringify(name),!!utils.applicationNameError(name))
  check('描述 350 位允许而 351 位拒绝',!utils.applicationDescriptionError('文'.repeat(350))&&!!utils.applicationDescriptionError('文'.repeat(351)))
  const tag=(key,value,propagate=false)=>({key,value,propagate})
  check('空标签行不参与提交',utils.applicationLabels([tag('','')]).length===0&&!utils.applicationTagErrors([tag('','')])[0].key)
  check('支持 DNS 前缀键与数字标签值',utils.applicationTagErrors([tag('example.com/team','123')]).every(row=>!row.key&&!row.value))
  check('标签值不能为空',!!utils.applicationTagErrors([tag('team','')])[0].value)
  check('标签键不能为空',!!utils.applicationTagErrors([tag('','platform')])[0].key)
  check('标签键重复逐行拒绝',utils.applicationTagErrors([tag('team','one'),tag('team','two')]).every(row=>row.key.includes('重复')))
  check('非法标签键前缀拒绝',!!utils.applicationTagErrors([tag('Bad Prefix/team','one')])[0].key)
  check('标签值长度及首尾校验',!!utils.applicationTagErrors([tag('team','a'.repeat(64))])[0].value&&!!utils.applicationTagErrors([tag('team','-bad')])[0].value)
  check('不借用原型属性判断重复键',utils.applicationTagErrors([tag('constructor','one')]).every(row=>!row.key&&!row.value))
  const pages=Array.from({length:225},(_,index)=>({id:'source-'+index,name:'source-'+index,archivedAt:index===50?'archived':null}))
  let calls=0
  const sources=await collect(async({page,pageSize})=>{calls++;return {items:pages.slice((page-1)*pageSize,page*pageSize),total:pages.length}})
  check('源应用读取全部分页并过滤归档',calls===3&&sources.length===224&&sources.at(-1).id==='source-224')
  let active=true
  check('过期请求不返回源列表',(await collect(async()=>{active=false;return {items:pages,total:pages.length}},()=>active)).length===0)
  check('空列表正常结束',(await collect(async()=>({items:[],total:0}))).length===0)
  await rejects('重复分页异常有错误反馈',()=>collect(async()=>({items:[pages[0]],total:500})),/分页异常/)
  const input={projectId:'p-shop',name:'round13-created',sourceMode:'git',description:'  description  ',labels:[tag('team','platform',true)]}
  const created=await api.createApplication(input)
  check('创建保存结构标签与传播意向',created.labels[0].propagate===true&&created.tags[0]==='team:platform')
  input.labels[0].value='mutated'
  created.labels[0].value='client'
  check('标签输入和返回值隔离',(await api.getApplication(created.id)).labels[0].value==='platform')
  check('从零创建无配置和环境绑定',(await api.getConfig(created.id)).version===0&&(await api.listBindings(created.id)).length===0)
  await rejects('项目无效拒绝创建',()=>api.createApplication({...input,name:'bad-project',projectId:'missing'}),/有效项目/)
  await rejects('同项目同名拒绝创建',()=>api.createApplication(input),/同名/)
  await rejects('超长名称在 Mock 同样拒绝',()=>api.createApplication({...input,name:'a'.repeat(31)}),/3–30/)
  await rejects('超长描述在 Mock 同样拒绝',()=>api.createApplication({...input,name:'long-description',description:'x'.repeat(351)}),/350/)
  await rejects('标签重复在 Mock 同样拒绝',()=>api.createApplication({...input,name:'duplicate-label',labels:[tag('team','one'),tag('team','two')]}),/标签/)
  await rejects('传播参数类型错误拒绝',()=>api.createApplication({...input,name:'bad-propagate',labels:[{key:'team',value:'platform',propagate:'yes'}]}),/传播/)
  const origin=await api.getConfig('a-checkout')
  const cloned=await api.createApplication({projectId:'p-data',name:'round13-clone',sourceMode:'git',cloneFromAppId:'a-checkout',labels:[tag('owner','copier')]})
  const config=await api.getConfig(cloned.id)
  check('跨项目克隆配置归属新应用并重置版本',cloned.projectId==='p-data'&&config.appId===cloned.id&&config.version===1)
  check('克隆保留 Git 与部署模板配置',JSON.stringify(config.gitConfig)===JSON.stringify(origin.gitConfig)&&JSON.stringify(config.chartConfig)===JSON.stringify(origin.chartConfig))
  check('克隆镜像仓库隔离为新应用',config.buildConfig.imageRepository===`podry/${cloned.id}`)
  config.deployValues.round13='changed'
  check('克隆配置与源配置独立',!(await api.getConfig('a-checkout')).deployValues.round13)
  check('克隆不复制环境流水线与历史',(await api.listBindings(cloned.id)).length===0&&(await api.getWorkflow(cloned.id)).items.length===0&&(await api.listBuilds(cloned.id)).items.length===0)
  check('克隆标签由新表单填写',cloned.labels[0].key==='owner')
  await rejects('源应用无效拒绝克隆',()=>api.createApplication({...input,name:'missing-clone',cloneFromAppId:'missing'}),/源应用不存在/)
  await rejects('源类型不一致拒绝克隆',()=>api.createApplication({...input,name:'wrong-clone-type',sourceMode:'image',cloneFromAppId:'a-checkout'}),/sourceMode/)
  await api.archiveApplication(created.id)
  await rejects('已归档源应用不可克隆',()=>api.createApplication({...input,name:'archived-clone',cloneFromAppId:created.id}),/源应用不存在/)
  check('失败创建不留下半个应用',!db.applications.some(app=>['bad-project','duplicate-label','bad-propagate','missing-clone'].includes(app.name)))
  await api.updateApplication(cloned.id,{tags:['legacy']})
  check('既有纯文本标签编辑清除过期结构标签',!(await api.getApplication(cloned.id)).labels)
  console.log(`${count} application creation checks passed`)
}finally{await server.close()}
