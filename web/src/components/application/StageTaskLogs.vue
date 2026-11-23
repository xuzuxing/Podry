<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { getStageRunLogs } from '@/api'
import type { PipelineTask, StageRun } from '@/types'
import { stageStatusLabel, stageTaskStatus } from '@/utils/stageRuns'
import HistoryLogViewer from './history/HistoryLogViewer.vue'
const props=defineProps<{run:StageRun;task:PipelineTask}>()
const text=shallowRef(''),error=shallowRef(''),loading=shallowRef(false)
let generation=0
async function load():Promise<void>{
  const current=++generation
  loading.value=true;error.value=''
  try{const value=await getStageRunLogs(props.run.appId,props.run.id,props.task.id);if(current!==generation)return;text.value=value}
  catch(err){if(current===generation)error.value=err instanceof Error?err.message:'任务日志加载失败'}
  finally{if(current===generation)loading.value=false}
}
watch(()=>[props.run,props.task.id] as const,(_,old)=>{if(!old || old[0]?.id!==props.run.id || old[1]!==props.task.id)text.value='';void load()},{immediate:true})
onBeforeUnmount(()=>generation++)
</script>
<template>
  <HistoryLogViewer class="stage-task-logs" :text="text" :context-key="`${run.id}:${task.id}`" :title="task.name" :status="stageStatusLabel[stageTaskStatus(run, run.snapshot.tasks.findIndex(item => item.id === task.id))]" :execution-status="stageTaskStatus(run, run.snapshot.tasks.findIndex(item => item.id === task.id))" :loading="loading" :error="error" :file-name="`${run.id}-${task.id}.log`" log-class="stage-task-logs__text" @refresh="load" />
</template>
