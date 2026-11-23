import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getWorkflow, listBindings, listEnvironments, listStageRuns } from '@/api'
import type { Binding, DeploymentStageType, Environment, Pipeline, StageRun } from '@/types'
import { stageIsActive } from '@/utils/stageRuns'

/** 查询只决定选择；快照来自记录，切换环境不会把旧详情留在新环境。 */
export function useStageRunHistory(stage: Readonly<Ref<DeploymentStageType>>) {
  const route=useRoute(), router=useRouter()
  const appId=computed(()=>String(route.params.appId ?? ''))
  const bindings=ref<Binding[]>([]), environments=ref<Environment[]>([]), pipelines=ref<Pipeline[]>([]), runs=ref<StageRun[]>([])
  const loading=shallowRef(false), refreshing=shallowRef(false), error=shallowRef('')
  let generation=0, timer:ReturnType<typeof setTimeout> | undefined
  const environmentOptions=computed(()=>environments.value.filter(env=>bindings.value.some(binding=>binding.environmentId===env.id)).map(env=>({label:env.name,value:env.id})))
  const environmentId=computed(()=>typeof route.query.env==='string'?route.query.env:bindings.value.find(binding=>binding.id===pipelines.value.find(item=>item.id===route.query.pipeline)?.bindingId)?.environmentId ?? environmentOptions.value[0]?.value ?? '')
  const pipelineOptions=computed(()=>{
    const bindingIds=bindings.value.filter(binding=>binding.environmentId===environmentId.value).map(binding=>binding.id)
    const current=pipelines.value.filter(item=>bindingIds.includes(item.bindingId ?? '')).map(item=>({label:item.id,value:item.id}))
    runs.value.filter(run=>run.environmentId===environmentId.value).forEach(run=>{if(!current.some(item=>item.value===run.pipelineId))current.push({label:run.pipelineId+'（已移除）',value:run.pipelineId})})
    return current
  })
  const pipelineId=computed(()=>typeof route.query.pipeline==='string'?route.query.pipeline:pipelineOptions.value[0]?.value ?? '')
  const records=computed(()=>runs.value.filter(run=>run.environmentId===environmentId.value && run.pipelineId===pipelineId.value && run.stage===stage.value))
  const detail=computed(()=>typeof route.query.run==='string'?records.value.find(run=>run.id===route.query.run) ?? null:records.value[0] ?? null)
  const environmentName=computed(()=>environmentOptions.value.find(item=>item.value===environmentId.value)?.label ?? environmentId.value)
  function schedule():void {
    if(timer)clearTimeout(timer)
    if(runs.value.some(run=>stageIsActive(run.status)))timer=setTimeout(()=>void refresh(),1800)
  }
  async function refresh():Promise<void> {
    const current=generation, id=appId.value, type=stage.value
    refreshing.value=true
    try {const list=await listStageRuns(id,undefined,type);if(current!==generation)return;runs.value=list;error.value=''}
    catch(err){if(current===generation)error.value=err instanceof Error?err.message:'阶段记录加载失败'}
    finally{if(current===generation){refreshing.value=false;schedule()}}
  }
  async function load():Promise<void> {
    const current=++generation, id=appId.value, type=stage.value
    if(timer)clearTimeout(timer)
    loading.value=true;error.value='';runs.value=[];bindings.value=[];pipelines.value=[];environments.value=[]
    try {
      const [workflow,bindingList,environmentList,list]=await Promise.all([getWorkflow(id),listBindings(id),listEnvironments(),listStageRuns(id,undefined,type)])
      if(current!==generation)return
      pipelines.value=workflow.items.filter(item=>item.kind==='cd');bindings.value=bindingList;environments.value=environmentList;runs.value=list
    }catch(err){if(current===generation)error.value=err instanceof Error?err.message:'阶段记录加载失败'}
    finally{if(current===generation){loading.value=false;refreshing.value=false;schedule()}}
  }
  function selectEnvironment(id:string):void {void router.push({query:{...route.query,env:id,pipeline:undefined,run:undefined,tab:undefined,task:undefined}})}
  function selectPipeline(id:string):void {void router.push({query:{...route.query,pipeline:id,run:undefined,tab:undefined,task:undefined}})}
  function selectRun(id:string):void {void router.push({query:{...route.query,env:environmentId.value,pipeline:pipelineId.value,run:id,tab:undefined,task:undefined}})}
  watch([appId,stage],()=>void load(),{immediate:true})
  onBeforeUnmount(()=>{generation++;if(timer)clearTimeout(timer)})
  return {appId,loading,refreshing,error,environmentOptions,environmentId,environmentName,pipelineOptions,pipelineId,records,detail,load,refresh,selectEnvironment,selectPipeline,selectRun}
}
