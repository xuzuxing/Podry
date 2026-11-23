<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DeploymentStageType } from '@/types'
import DeploymentHistoryView from './DeploymentHistoryView.vue'
import StageRunHistory from '@/components/application/StageRunHistory.vue'
const route=useRoute(),router=useRouter()
const type=computed(()=>route.query.type==='PRECD'||route.query.type==='POSTCD'?route.query.type:'CD')
function select(value:'CD'|DeploymentStageType):void{
  void router.push({query:{...route.query,type:value,run:undefined,tab:undefined,task:undefined}})
}
</script>
<template>
  <div class="deployment-activity"><nav class="deployment-activity__tabs" aria-label="发布历史阶段"><button v-for="item in [{value:'PRECD' as const,label:'Pre-deployment'},{value:'CD' as const,label:'Deployment'},{value:'POSTCD' as const,label:'Post-deployment'}]" :key="item.value" :class="{active:type===item.value}" :aria-current="type===item.value?'page':undefined" @click="select(item.value)">{{ item.label }}</button></nav><div class="deployment-activity__content"><DeploymentHistoryView v-if="type==='CD'" /><StageRunHistory v-else :stage="type" /></div></div>
</template>
<style scoped>
.deployment-activity{display:flex;flex-direction:column;height:calc(100dvh - 102px);min-height:480px;margin:-12px -16px -24px;background:white;overflow:hidden}.deployment-activity__tabs{display:flex;flex:none;gap:24px;padding:0 24px;border-bottom:1px solid #e6e9ef}.deployment-activity__tabs button{border:0;border-bottom:2px solid transparent;background:none;padding:12px 0;color:#596168;font:inherit;font-size:13px;cursor:pointer}.deployment-activity__tabs button.active{color:#0066cc;border-bottom-color:#0066cc}.deployment-activity__content{flex:1;min-height:0;min-width:0;display:flex}.deployment-activity__content :deep(.dh){width:100%;height:100%;min-height:0;margin:0}
</style>
