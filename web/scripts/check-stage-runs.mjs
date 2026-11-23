// 独立阶段运行与历史快照的 Mock 边界；没有实际执行任务或部署。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
let count=0
function check(name,value){assert.ok(value,name);count++;console.log('PASS '+name)}
async function rejects(name,promise,pattern){await assert.rejects(promise,pattern);count++;console.log('PASS '+name)}
try{
  const api=await server.ssrLoadModule('/src/api/index.ts'),db=await server.ssrLoadModule('/src/mock/data.ts')
  const {advanceStageRun,stageTaskStatus}=await server.ssrLoadModule('/src/utils/stageRuns.ts')
  const appId='a-checkout',pipelineId='pl-checkout-cd-staging'
  const pipeline=db.workflows[appId].items.find(item=>item.id===pipelineId),definition=pipeline.definition
  const config=db.appConfigs[appId],workflow=db.workflows[appId]
  const images=await api.listStageImages(appId,pipelineId)
  const input={pipelineId,stage:'PRECD',artifactId:images[0].id,configVersion:config.version,workflowVersion:workflow.version}
  const trigger=patch=>api.triggerStageRun(appId,{...input,...patch})
  check('初始阶段历史与 Deployment 分开存储',(await api.listStageRuns(appId)).length===0)
  check('阶段镜像只包含应用和上游 CI 的产物',images.length>0 && images.every(item=>item.appId===appId && (item.source==='external'||db.builds.find(build=>build.id===item.buildId)?.pipelineId===definition.upstreamPipelineId)))
  await rejects('拒绝未配置任务的阶段',trigger({pipelineId:'pl-checkout-cd-dev'}),/没有可执行任务/)
  await rejects('拒绝错误阶段类型',trigger({stage:'CD'}),/前置或后置/)
  await rejects('拒绝旧配置版本',trigger({configVersion:config.version-1}),/配置或流水线已更新/)
  await rejects('拒绝旧工作流版本',trigger({workflowVersion:workflow.version-1}),/配置或流水线已更新/)
  await rejects('拒绝其他应用流水线',api.triggerStageRun('a-payment',input),/流水线不存在/)
  const foreign=db.artifacts.find(item=>item.appId!=='a-checkout')
  await rejects('拒绝其他应用镜像',trigger({artifactId:foreign.id}),/不属于此应用或上游/)
  const alien={...images[0],id:'artifact-other-ci',buildId:'build-other-ci'}
  db.artifacts.push(alien);db.builds.push({...db.builds.find(item=>item.id===images[0].buildId),id:'build-other-ci',appId,pipelineId:'different-ci'})
  check('镜像目录排除另一个 CI',(await api.listStageImages(appId,pipelineId)).every(item=>item.id!==alien.id))
  await rejects('不能绕过目录触发另一个 CI 镜像',trigger({artifactId:alien.id}),/不属于此应用或上游/)
  const refs={configMaps:['checkout-api-config'],secrets:['checkout-api-secret']}
  definition.preStageResources=refs
  const deployCount=db.deployments.length,bindingState=JSON.stringify(db.bindings),run=await trigger({})
  check('触发生成独立 queued 记录',run.stage==='PRECD' && run.status==='queued' && run.attemptNo===1)
  check('触发阶段不会创建发布或改动环境状态',db.deployments.length===deployCount && JSON.stringify(db.bindings)===bindingState)
  check('运行记录固定镜像 digest 和配置版本',run.snapshot.artifact.digest===images[0].digest && run.workflowVersion===workflow.version && run.configVersion===config.version)
  check('运行记录保存实际环境目标',run.snapshot.target.namespace==='shop-staging' && run.environmentId==='e-staging')
  check('配置快照包含有效 CM 及 Secret 键元数据',run.snapshot.configMaps[0].name==='checkout-api-config' && run.snapshot.secrets[0].keys.length>0 && !JSON.stringify(run.snapshot.secrets).includes('"data"'))
  await rejects('同一阶段防止重复并发触发',trigger({}),/已有运行中的记录/)
  const post=await trigger({stage:'POSTCD'})
  check('前后置可以各自运行和筛选',(await api.listStageRuns(appId,pipelineId,'PRECD')).length===1 && (await api.listStageRuns(appId,pipelineId,'POSTCD')).length===1)
  check('其他应用不能读取记录',(await api.listStageRuns('a-payment')).length===0)
  await rejects('其他应用不能读取日志',api.getStageRunLogs('a-payment',run.id,run.snapshot.tasks[0].id),/记录不存在/)
  await rejects('日志任务必须属于当前运行',api.getStageRunLogs(appId,run.id,'not-a-task'),/任务不属于/)
  const logs=await api.getStageRunLogs(appId,run.id,run.snapshot.tasks[0].id)
  check('日志明确为 Mock 并固定镜像 digest',logs.includes('[Mock]') && logs.includes(images[0].digest) && logs.includes('没有执行脚本'))
  const originalScript=run.snapshot.tasks[0].script
  definition.preTasks[0].script='echo changed current configuration'
  db.artifacts.find(item=>item.id===images[0].id).notes='changed current artifact'
  check('后续流水线和镜像修改不污染快照',(await api.listStageRuns(appId,pipelineId,'PRECD'))[0].snapshot.tasks[0].script===originalScript && !run.snapshot.artifact.notes?.includes('changed current'))
  run.snapshot.tasks[0].script='mutated response'
  check('返回值深副本隔离',(await api.listStageRuns(appId,pipelineId,'PRECD'))[0].snapshot.tasks[0].script===originalScript)
  await rejects('其他应用不能取消',api.cancelStageRun('a-payment',run.id),/记录不存在/)
  const canceled=await api.cancelStageRun(appId,run.id)
  check('可取消运行且记录结束时间',canceled.status==='canceled' && Boolean(canceled.finishedAt))
  await rejects('结束记录不能再次取消',api.cancelStageRun(appId,run.id),/已结束/)
  const retry=await api.retryStageRun(appId,run.id)
  check('重试创建新记录并关联原始运行',retry.id!==run.id && retry.retryOf===run.id && retry.attemptNo===2 && retry.status==='queued')
  check('重试沿用原任务与镜像快照',retry.snapshot.tasks[0].script===originalScript && retry.snapshot.artifact.notes===canceled.snapshot.artifact.notes && retry.workflowVersion===canceled.workflowVersion)
  await rejects('存在重试时拒绝重复重试',api.retryStageRun(appId,run.id),/已有运行中的记录/)
  await api.cancelStageRun(appId,retry.id)
  const previousTarget={...db.bindingById(run.bindingId).target}
  db.bindingById(run.bindingId).target.namespace='changed-namespace'
  await rejects('环境目标变化不能沿用历史快照执行',api.retryStageRun(appId,run.id),/目标环境已变更/)
  db.bindingById(run.bindingId).target=previousTarget
  db.bindingById(run.bindingId).target={releaseName:previousTarget.releaseName,namespace:previousTarget.namespace,clusterId:previousTarget.clusterId}
  const reordered=await api.retryStageRun(appId,run.id)
  check('字段顺序变化不误判为目标变化',reordered.status==='queued')
  await api.cancelStageRun(appId,reordered.id);db.bindingById(run.bindingId).target=previousTarget
  const stored=db.stageRuns.find(item=>item.id===post.id)
  stored.createdAt=new Date(Date.now()-2000).toISOString()
  check('刷新推进到运行状态',(await api.listStageRuns(appId,pipelineId,'POSTCD'))[0].status==='running')
  stored.createdAt=new Date(Date.now()-31_000).toISOString()
  const complete=(await api.listStageRuns(appId,pipelineId,'POSTCD'))[0]
  check('Mock 时间推进到成功并固定结束时间',complete.status==='succeeded' && Date.parse(complete.finishedAt)===Date.parse(complete.createdAt)+30_000)
  await rejects('成功阶段不能当作失败重试',api.retryStageRun(appId,complete.id),/仅失败或已取消/)
  stored.status='failed'
  const failedRetry=await api.retryStageRun(appId,stored.id)
  check('失败阶段可独立重试',failedRetry.stage==='POSTCD' && failedRetry.retryOf===stored.id)
  await api.cancelStageRun(appId,failedRetry.id)
  definition.preStageResources={configMaps:['deleted-resource'],secrets:[]}
  await rejects('失效配置引用阻止新触发',trigger({}),/已不可用/)
  definition.preStageResources=refs;definition.runPreStageInEnv=true
  const cluster=db.clusters.find(item=>item.id==='c-dev');cluster.cdWorkerEnabled=false
  await rejects('worker 不可用时阻止新触发',trigger({}),/未配置部署 worker/)
  cluster.cdWorkerEnabled=true
  const inEnv=await trigger({});await api.cancelStageRun(appId,inEnv.id);cluster.cdWorkerEnabled=false
  await rejects('重试仍检查原快照的 worker 能力',api.retryStageRun(appId,inEnv.id),/未配置部署 worker/)
  cluster.cdWorkerEnabled=true;pipeline.enabled=false
  await rejects('禁用流水线不能重试历史记录',api.retryStageRun(appId,run.id),/不存在或已禁用/)
  pipeline.enabled=true
  const pure={...complete,status:'queued',createdAt:new Date(0).toISOString(),finishedAt:null}
  advanceStageRun(pure,1500);check('状态推进函数可确定性验证',pure.status==='running' && stageTaskStatus(pure,0,1500)==='running')
  advanceStageRun(pure,30_000);check('纯状态推进不会修改历史任务快照',pure.status==='succeeded' && pure.snapshot.tasks[0].id===complete.snapshot.tasks[0].id)
  check('所有阶段操作不创建 Deployment',db.deployments.length===deployCount)
  console.log(`Completed ${count} stage run Mock checks`)
}finally{await server.close()}
