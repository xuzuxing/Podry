// 本地 Mock 契约检查；验证逐仓库选择、配置冲突与历史快照，不执行真实构建。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let checks = 0
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS ' + name) }
async function rejects(name, promise, pattern) { await assert.rejects(promise, pattern); checks++; console.log('PASS ' + name) }
try {
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { gitMaterialsOf } = await server.ssrLoadModule('/src/utils/gitMaterials.ts')
  const { buildDraft } = await server.ssrLoadModule('/src/types/build.ts')
  const appId = 'a-checkout'
  let cfg = await api.getConfig(appId)
  const first = gitMaterialsOf(cfg)[0]
  const second = { ...first, id: 'git-assets', repositoryUrl: 'https://github.com/acme/web-assets.git', checkoutPath: './assets' }
  cfg = await api.saveConfig(appId, {section:'git',expectedVersion:cfg.version,gitMaterials:[first,second]})
  let wf = await api.getWorkflow(appId)
  const originalCi = wf.items.find(item => item.kind === 'ci')
  const ci = { ...originalCi, id:'ci-material-check', definition:{...originalCi.definition, branch:'main',materials:[{gitMaterialId:first.id,type:'regex',value:'^(main|release/1\\.x)$'},{gitMaterialId:second.id,type:'branch',value:'main'}],buildOverride:{...buildDraft(cfg.buildConfig,first.id),gitMaterialId:second.id,imageRepository:'acme/preview',dockerfile:'docker/Preview.Dockerfile',buildArguments:[{key:'VERSION',value:'preview'}]}} }
  wf = await api.saveWorkflow(appId,{version:wf.version,items:[...wf.items,ci]},cfg.version)
  const commits1 = await api.listCommits('main',appId,first.id)
  const commits2 = await api.listCommits('main',appId,second.id)
  check('不同仓库有独立提交集合',commits1[0].sha !== commits2[0].sha)
  check('同一仓库提交稳定可回读',(await api.listCommits('main',appId,second.id))[0].sha === commits2[0].sha)
  check('仓库分支头与该仓库最新提交一致',(await api.listBranches(appId,second.id)).find(item=>item.name==='main').headSha===commits2[0].sha)
  check('分支提交集合独立',(await api.listCommits('release/1.x',appId,first.id))[0].sha !== commits1[0].sha)
  const picks = [{gitMaterialId:first.id,branch:'main',commitSha:commits1[1].sha},{gitMaterialId:second.id,branch:'main',commitSha:commits2[0].sha}]
  const trigger = selection => api.triggerBuild(appId,commits2[0].sha,cfg.version,ci.id,'main',selection)
  await rejects('多仓库不能使用单仓库触发入参',trigger(),/每个 Git 仓库/)
  await rejects('拒绝缺少仓库提交',trigger({workflowVersion:wf.version,materials:picks.slice(0,1)}),/每个 Git 仓库/)
  await rejects('拒绝重复仓库选择',trigger({workflowVersion:wf.version,materials:[picks[0],picks[0]]}),/每个 Git 仓库/)
  await rejects('拒绝串用其他仓库提交',trigger({workflowVersion:wf.version,materials:[picks[0],{...picks[1],commitSha:commits1[0].sha}]}),/不属于该仓库/)
  await rejects('拒绝不匹配的分支',trigger({workflowVersion:wf.version,materials:[{...picks[0],branch:'feature/order-split'},picks[1]]}),/不匹配/)
  await rejects('拒绝过期流水线版本',trigger({workflowVersion:wf.version-1,materials:picks}),/流水线已更新/)
  await rejects('拒绝过期应用配置版本',api.triggerBuild(appId,commits2[0].sha,cfg.version-1,ci.id,'main',{workflowVersion:wf.version,materials:picks}),/配置已更新/)
  const build = await trigger({workflowVersion:wf.version,materials:picks})
  check('触发后捕获所有源码及克隆路径',build.materials.length === 2 && build.materials[1].checkoutPath === './assets')
  check('主提交跟随覆盖的源码仓库',build.commitSha === commits2[0].sha && build.repositoryUrl === second.repositoryUrl)
  check('捕获有效流水线覆盖',build.buildConfigSnapshot.imageRepository === 'acme/preview' && build.buildConfigSnapshot.dockerfile === 'docker/Preview.Dockerfile')
  await api.cancelBuild(build.id)
  cfg = await api.saveConfig(appId,{section:'build',expectedVersion:cfg.version,buildConfig:{...cfg.buildConfig,imageRepository:'acme/new-base'}})
  const removedOverride = {...ci,definition:{...ci.definition,buildOverride:null}}
  wf = await api.saveWorkflow(appId,{version:wf.version,items:wf.items.map(item => item.id === ci.id ? removedOverride : item)},cfg.version)
  check('修改配置不改写旧构建',(await api.getBuild(build.id)).buildConfigSnapshot.imageRepository === 'acme/preview')
  const retry = await api.retryBuild(build.id)
  check('重试固定所有仓库提交',JSON.stringify(retry.materials) === JSON.stringify(build.materials))
  check('重试保留原构建配置',JSON.stringify(retry.buildConfigSnapshot) === JSON.stringify(build.buildConfigSnapshot))
  retry.materials[0].repositoryUrl = 'client-mutation'
  check('历史返回值是独立副本',(await api.getBuild(retry.id)).materials[0].repositoryUrl === first.repositoryUrl)
  await api.cancelBuild(retry.id)
  const inherited = await trigger({workflowVersion:wf.version,materials:picks})
  check('删除覆盖恢复最新应用构建配置',inherited.buildConfigSnapshot.imageRepository === 'acme/new-base')
  await api.cancelBuild(inherited.id)
  const invalidCi = {...removedOverride,definition:{...removedOverride.definition,materials:[{...picks[0],type:'regex',value:'['},{gitMaterialId:second.id,type:'branch',value:'main'}]}}
  await rejects('拒绝无效分支正则',api.saveWorkflow(appId,{version:wf.version,items:[invalidCi]}),/正则表达式无效/)
  await rejects('拒绝重复代码源',api.saveWorkflow(appId,{version:wf.version,items:[{...ci,definition:{...ci.definition,materials:[ci.definition.materials[0],ci.definition.materials[0]]}}]}),/唯一代码源/)
  await rejects('拒绝无效构建覆盖',api.saveWorkflow(appId,{version:wf.version,items:[{...ci,definition:{...ci.definition,buildOverride:{...ci.definition.buildOverride,dockerfile:'../escape'}}}]}),/相对路径/)
  await rejects('拒绝过期工作流保存',api.saveWorkflow(appId,{version:wf.version-1,items:wf.items}),/重新读取/)
  await rejects('拒绝应用配置过期时保存覆盖',api.saveWorkflow(appId,{version:wf.version,items:wf.items},cfg.version-1),/重新读取/)
  wf = await api.saveWorkflow(appId,{version:wf.version,items:wf.items.map(item => item.id === ci.id ? ci : item)})
  await rejects('流水线覆盖引用的仓库不可删除',api.saveConfig(appId,{section:'git',expectedVersion:cfg.version,gitMaterials:[first]}),/流水线构建覆盖/)
  const third={...second,id:'git-shared',repositoryUrl:'https://github.com/acme/shared.git',checkoutPath:'./shared'}
  cfg=await api.saveConfig(appId,{section:'git',expectedVersion:cfg.version,gitMaterials:[first,second,third]})
  wf=await api.getWorkflow(appId)
  check('新增仓库补齐已配置流水线代码源',wf.items.find(item=>item.id===ci.id).definition.materials.length===3)
  check('新增仓库保留原有分支正则',wf.items.find(item=>item.id===ci.id).definition.materials[0].value===ci.definition.materials[0].value)
  cfg=await api.saveConfig(appId,{section:'git',expectedVersion:cfg.version,gitMaterials:[first,second]})
  wf=await api.getWorkflow(appId)
  check('删除仓库清除流水线失效代码源',wf.items.find(item=>item.id===ci.id).definition.materials.length===2)
  check('同步后仍能保存现有工作流',(await api.saveWorkflow(appId,wf)).items.length===wf.items.length)
  check('旧构建保持缺失快照状态',!(await api.listBuilds(appId)).items.find(item => item.id !== build.id && item.id !== retry.id && item.id !== inherited.id).materials)
  check('生成日志反映全部仓库',(await api.getBuildLogs(build.id)).join('\n').includes(second.repositoryUrl))
  console.log(`Completed ${checks} Mock build material checks`)
} finally { await server.close() }
