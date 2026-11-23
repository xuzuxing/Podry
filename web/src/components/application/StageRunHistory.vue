<script setup lang="ts">
import { onBeforeUnmount, shallowRef, toRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { cancelStageRun, retryStageRun } from '@/api'
import type { DeploymentStageType, StageRun } from '@/types'
import { useStageRunHistory } from '@/composables/useStageRunHistory'
import { stageStatusLabel, stageTitle } from '@/utils/stageRuns'
import { fmtTime } from '@/utils/format'
import StageRunDetail from './StageRunDetail.vue'
import EmptyState from '@/components/EmptyState.vue'
const props=defineProps<{stage:DeploymentStageType}>()
const route=useRoute()
const {appId,loading,refreshing,error,environmentOptions,environmentId,environmentName,pipelineOptions,pipelineId,records,detail,load,refresh,selectEnvironment,selectPipeline,selectRun}=useStageRunHistory(toRef(props,'stage'))
const acting=shallowRef(false),actionError=shallowRef('')
const cancelTarget=shallowRef<StageRun|null>(null)
let mounted=true
async function act(kind:'cancel'|'retry',run:StageRun):Promise<void>{
  if(acting.value)return
  acting.value=true;actionError.value=''
  const context=`${appId.value}:${props.stage}`
  try{
    const updated=kind==='cancel'?await cancelStageRun(run.appId,run.id):await retryStageRun(run.appId,run.id)
    if(!mounted || context!==`${appId.value}:${props.stage}`)return
    cancelTarget.value=null;await refresh()
    if(kind==='retry')selectRun(updated.id)
  }catch(err){if(mounted && context===`${appId.value}:${props.stage}`)actionError.value=err instanceof Error?err.message:'阶段操作失败'}
  finally{acting.value=false}
}
watch(()=>[props.stage,appId.value,route.query.run],()=>{actionError.value='';cancelTarget.value=null})
onBeforeUnmount(()=>{mounted=false})
</script>
<template>
  <div class="stage-run-history">
    <aside class="stage-run-history__side"><div class="stage-run-history__selectors"><label>选择环境</label><t-select :value="environmentId" :options="environmentOptions" aria-label="阶段历史环境" @change="typeof $event==='string' && selectEnvironment($event)" /><label>部署流水线</label><t-select :value="pipelineId" :options="pipelineOptions" aria-label="阶段历史流水线" @change="typeof $event==='string' && selectPipeline($event)" /><div><strong>{{ stageTitle(stage) }}</strong><t-button size="small" variant="text" aria-label="刷新阶段历史" :loading="refreshing" @click="refresh">刷新</t-button></div></div>
      <div v-if="loading" class="stage-run-history__state"><t-loading text="读取阶段历史…" size="small" /></div>
      <div v-else-if="!records.length" class="stage-run-history__state">此环境和流水线暂无阶段记录</div>
      <ul v-else class="stage-run-history__records"><li v-for="run in records" :key="run.id"><button :class="{active:detail?.id===run.id}" :data-run-id="run.id" @click="selectRun(run.id)"><span :data-status="run.status">{{ stageStatusLabel[run.status] }}</span><strong>{{ fmtTime(run.createdAt) }}</strong><small>{{ run.snapshot.artifact.imageRef.split('/').pop() }} · {{ run.operator }} · #{{ run.attemptNo }}</small></button></li></ul>
    </aside>
    <section class="stage-run-history__main"><t-alert v-if="error || actionError" theme="error" :message="actionError || error"><template #operation><t-button variant="text" size="small" @click="load">重新读取</t-button></template></t-alert><StageRunDetail v-if="detail" :run="detail" :environment-name="environmentName" :acting="acting" @cancel="cancelTarget=detail" @retry="act('retry',detail)" /><EmptyState v-else-if="!loading" :title="route.query.run?'未找到此阶段运行记录':'暂无阶段运行记录'" description="请选择正确的环境、流水线和阶段，或从构建发布页选择镜像运行阶段。" /></section>
    <t-dialog :visible="Boolean(cancelTarget)" header="取消阶段运行" theme="warning" :confirm-btn="{content:'确认取消',loading:acting}" :close-on-overlay-click="!acting" @confirm="cancelTarget && act('cancel',cancelTarget)" @close="!acting && (cancelTarget=null)"><p>取消 {{ cancelTarget ? stageTitle(cancelTarget.stage) : '' }} 的本地示例运行。</p><p class="stage-run-history__id">{{ cancelTarget?.id }}</p></t-dialog>
  </div>
</template>
<style scoped>
.stage-run-history{display:grid;grid-template-columns:296px minmax(0,1fr);width:100%;height:100%;min-height:0;background:white;color:#000a14}.stage-run-history__side{display:flex;flex-direction:column;min-height:0;border-right:1px solid #e6e9ef}.stage-run-history__selectors{padding:16px;border-bottom:1px solid #e6e9ef;display:flex;flex-direction:column;gap:8px}.stage-run-history__selectors>label{font-size:12px;color:#767d84}.stage-run-history__selectors>div:last-child{display:flex;align-items:center;justify-content:space-between;font-size:12px}.stage-run-history__records{list-style:none;margin:0;padding:0;overflow:auto;flex:1;min-height:0}.stage-run-history__records button{display:flex;flex-direction:column;gap:6px;text-align:left;padding:16px;width:100%;background:white;border:0;border-bottom:1px solid #edf1f5;cursor:pointer;color:#000a14}.stage-run-history__records button.active{background:#e8f0fe;border-left:3px solid #0066cc;padding-left:13px}.stage-run-history__records span{font-size:12px;color:#ff8300}.stage-run-history__records [data-status=succeeded]{color:#1dad70}.stage-run-history__records [data-status=canceled],.stage-run-history__records [data-status=failed]{color:#d54941}.stage-run-history__records strong{font-size:13px;font-weight:500}.stage-run-history__records small{font-size:11px;color:#767d84;overflow-wrap:anywhere}.stage-run-history__main{display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}.stage-run-history__main>.stage-run-detail{flex:1;min-height:0}.stage-run-history__state{padding:24px 16px;color:#767d84;font-size:12px}.stage-run-history__id{overflow-wrap:anywhere;font-size:12px}
</style>
