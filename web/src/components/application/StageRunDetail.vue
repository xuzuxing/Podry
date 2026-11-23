<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { stringify } from 'yaml'
import type { StageRun } from '@/types'
import { stageIsActive, stageStatusLabel, stageTaskStatus, stageTitle } from '@/utils/stageRuns'
import { outputPathsOf } from '@/utils/taskExecution'
import { fmtTime } from '@/utils/format'
import BuildSourceSnapshot from './BuildSourceSnapshot.vue'
import StageTaskLogs from './StageTaskLogs.vue'
import EmptyState from '@/components/EmptyState.vue'
const props=defineProps<{run:StageRun;environmentName:string;acting:boolean}>()
const emit=defineEmits<{cancel:[];retry:[]}>()
const route=useRoute(),router=useRouter()
const tab=computed(()=>route.query.tab===undefined?'logs':typeof route.query.tab==='string'?route.query.tab:'')
const validTab=computed(()=>['logs','source','config','artifacts'].includes(tab.value))
const taskId=computed(()=>route.query.task===undefined?props.run.snapshot.tasks[0]?.id ?? '':typeof route.query.task==='string'?route.query.task:'')
const task=computed(()=>props.run.snapshot.tasks.find(item=>item.id===taskId.value))
function selectTab(value:string):void{void router.replace({query:{...route.query,tab:value}})}
function selectTask(value:string):void{void router.push({query:{...route.query,tab:'logs',task:value}})}
const yaml=computed(()=>stringify({stage:props.run.stage,settings:props.run.snapshot.settings,target:props.run.snapshot.target,tasks:props.run.snapshot.tasks,resources:props.run.snapshot.resources,configMaps:props.run.snapshot.configMaps,secrets:props.run.snapshot.secrets}))
const paths=computed(()=>props.run.snapshot.tasks.flatMap(item=>outputPathsOf(item).map(path=>({task:item.name,path}))))
</script>
<template>
  <section class="stage-run-detail" :data-run-id="run.id">
    <header class="stage-run-timeline"><div><p><strong>{{ stageTitle(run.stage) }}</strong><span>→ {{ environmentName }}</span><t-tag size="small" variant="light" :theme="run.status==='succeeded'?'success':run.status==='failed'||run.status==='canceled'?'danger':'warning'">{{ stageStatusLabel[run.status] }}</t-tag></p><p>{{ fmtTime(run.createdAt) }} · {{ run.operator }} · 第 {{ run.attemptNo }} 次运行</p><p class="stage-run-timeline__image">{{ run.snapshot.artifact.imageRef }}</p><p>配置 v{{ run.configVersion }} / 流水线 v{{ run.workflowVersion }}<span v-if="run.finishedAt"> · 结束 {{ fmtTime(run.finishedAt) }}</span></p></div><div class="stage-run-timeline__actions"><t-button v-if="stageIsActive(run.status)" theme="danger" variant="outline" :disabled="acting" @click="emit('cancel')">取消运行</t-button><t-button v-if="run.status==='failed'||run.status==='canceled'" theme="primary" :loading="acting" @click="emit('retry')">重试阶段</t-button></div></header>
    <p class="stage-run-detail__notice">本地 Mock：日志与状态为演示数据，没有执行任务或触发部署。重试沿用本次快照。</p>
    <nav class="stage-run-tabs" aria-label="阶段运行详情"><button v-for="item in [{id:'logs',label:'Logs'},{id:'source',label:'Source'},{id:'config',label:'Configuration'},{id:'artifacts',label:'Artifacts'}]" :key="item.id" :class="{active:tab===item.id}" @click="selectTab(item.id)">{{ item.label }}</button></nav>
    <div v-if="!validTab" class="stage-run-detail__content"><EmptyState title="未找到此运行页签" description="请选择 Logs、Source、Configuration 或 Artifacts。" /></div>
    <div v-else-if="tab==='logs'" class="stage-run-log-workspace"><aside><button v-for="(item,index) in run.snapshot.tasks" :key="item.id" :class="{active:task?.id===item.id}" :data-status="stageTaskStatus(run,index)" @click="selectTask(item.id)"><span>{{ index+1 }}. {{ item.name }}</span><small>{{ stageStatusLabel[stageTaskStatus(run,index)] }}</small></button></aside><StageTaskLogs v-if="task" :run="run" :task="task" /><EmptyState v-else title="未找到此历史任务" description="请选择左侧任务；不会回退到其他任务的日志。" /></div>
    <div v-else-if="tab==='source'" class="stage-run-detail__content"><BuildSourceSnapshot v-if="run.snapshot.build" :build="run.snapshot.build" /><EmptyState v-else title="外部镜像没有源码构建快照" description="保留触发时的镜像 digest，不使用应用当前 Git 配置填充历史。" /><dl class="stage-run-image-snapshot"><dt>镜像地址</dt><dd>{{ run.snapshot.artifact.imageRef }}</dd><dt>digest</dt><dd>{{ run.snapshot.artifact.digest }}</dd></dl></div>
    <div v-else-if="tab==='config'" class="stage-run-detail__content"><p>触发时保存的阶段配置；后续修改不会改变此快照。Secret 仅包含键与挂载元数据。</p><pre class="stage-run-config" aria-label="阶段配置快照">{{ yaml }}</pre></div>
    <div v-else class="stage-run-detail__content"><EmptyState title="本地 Mock 未生成任务产物" description="配置中的产物路径不代表实际存在的文件。" compact /><ul v-if="paths.length" class="stage-run-declared-paths"><li v-for="(item,index) in paths" :key="index">配置路径 · {{ item.task }} · {{ item.path }}</li></ul></div>
  </section>
</template>
<style scoped>
.stage-run-detail{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.stage-run-timeline{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 24px 12px;border-bottom:1px solid #e6e9ef}.stage-run-timeline>div:first-child{min-width:0}.stage-run-timeline p{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 8px;font-size:12px;line-height:18px;color:#767d84}.stage-run-timeline strong{font-size:14px;color:#000a14}.stage-run-timeline p.stage-run-timeline__image{color:#000a14;overflow-wrap:anywhere;display:block}.stage-run-timeline__actions{flex:none}.stage-run-detail__notice{padding:8px 24px;margin:0;background:#f7fafc;color:#767d84;font-size:12px;line-height:18px}.stage-run-tabs{display:flex;gap:24px;padding:0 24px;border-bottom:1px solid #e6e9ef}.stage-run-tabs button{padding:12px 0;border:0;border-bottom:2px solid transparent;background:none;color:#596168;cursor:pointer;font:inherit}.stage-run-tabs button.active{color:#0066cc;border-bottom-color:#0066cc}.stage-run-log-workspace{display:grid;grid-template-columns:190px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.stage-run-log-workspace>aside{padding:12px 8px;overflow:auto;border-right:1px solid #e6e9ef;background:#f7fafc}.stage-run-log-workspace>aside button{display:flex;flex-direction:column;gap:6px;width:100%;padding:10px 8px;text-align:left;border:1px solid transparent;border-radius:4px;background:none;font:inherit;font-size:12px;cursor:pointer;overflow-wrap:anywhere}.stage-run-log-workspace>aside button.active{background:#e8f0fe;border-color:#b3d6ff}.stage-run-log-workspace small{color:#767d84}.stage-run-log-workspace [data-status=succeeded] small{color:#1dad70}.stage-run-log-workspace [data-status=failed] small,.stage-run-log-workspace [data-status=canceled] small{color:#d54941}.stage-run-detail__content{flex:1;min-height:0;overflow:auto;padding:16px 24px;font-size:12px;line-height:20px}.stage-run-config{background:#f7fafc;border:1px solid #e6e9ef;overflow:auto;padding:16px;font:12px/22px Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.stage-run-image-snapshot dd{margin:0;overflow-wrap:anywhere}.stage-run-image-snapshot dt{margin-top:12px;color:#767d84}.stage-run-declared-paths{padding:16px;overflow-wrap:anywhere}
</style>
