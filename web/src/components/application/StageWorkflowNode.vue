<script setup lang="ts">
import type { DeploymentStageType } from '@/types'
import type { TriggerStatus } from '@/views/apps/components/pipeline/TriggerGraph.vue'
import { stageTitle } from '@/utils/stageRuns'
defineProps<{ pipelineId: string; stage: DeploymentStageType; trigger: 'MANUAL' | 'AUTO'; status?: TriggerStatus; x: number; y: number }>()
const emit = defineEmits<{ image: [pipelineId: string, stage: DeploymentStageType]; details: [pipelineId: string, stage: DeploymentStageType] }>()
</script>

<template>
  <div class="stage-node" :data-stage="stage" :data-pipeline="pipelineId" :style="{left:`${x}px`,top:`${y}px`}" :class="{'stage-node--clickable':status?.details}" @click="status?.details && emit('details',pipelineId,stage)">
    <span class="stage-node__trigger" :title="trigger==='AUTO'?'上一阶段成功后自动触发':'手动选择镜像触发'"><span>{{ trigger === 'AUTO' ? '自动' : '手动' }}</span></span>
    <div class="stage-node__title"><div><span>Stage</span><strong>{{ stageTitle(stage) }}</strong></div><t-icon name="code" size="22px" /></div>
    <div class="stage-node__status" :data-tone="status?.tone ?? 'neutral'">{{ status?.label ?? '未触发' }}<template v-if="status?.details"><span>/</span><button type="button" @click.stop="emit('details',pipelineId,stage)">详情</button></template></div>
    <button class="stage-node__image" type="button" @click.stop="emit('image',pipelineId,stage)">选择镜像</button>
  </div>
</template>

<style scoped>
.stage-node{position:absolute;box-sizing:border-box;width:200px;height:126px;padding-left:16px;background:white;border:1px solid #d0d4d9;border-radius:8px;color:#000a14}
.stage-node--clickable{cursor:pointer}.stage-node--clickable:hover{border-color:#b1b7bc}
.stage-node__trigger{position:absolute;left:-1px;top:-1px;display:flex;align-items:center;justify-content:center;width:16px;height:calc(100% + 2px);border-radius:8px 0 0 8px;background:#a5a7bf;font-size:10px;font-weight:600;color:white}
.stage-node__trigger>span{writing-mode:vertical-rl;white-space:nowrap;line-height:16.67px}
.stage-node__title{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 0;gap:8px}
.stage-node__title>div{display:flex;flex-direction:column;gap:2px}.stage-node__title span{font-size:11px;color:#767d84}.stage-node__title strong{font-size:13px;font-weight:600}.stage-node__title>.t-icon{color:#596168}
.stage-node__status{display:flex;gap:5px;margin:7px 12px 9px;font-size:12px;font-weight:600;color:#767d84}
.stage-node__status[data-tone=success]{color:#1dad70}.stage-node__status[data-tone=danger]{color:#f33e3e}.stage-node__status[data-tone=warning]{color:#ff8300}
.stage-node__status button{border:0;background:none;color:#0066cc;font:inherit;padding:0;cursor:pointer}
.stage-node__image{display:block;width:158px;height:30px;margin:0 12px;background:white;border:1px solid #d0d4d9;border-radius:4px;font-family:inherit;font-size:12px;font-weight:600;line-height:18px;cursor:pointer}
.stage-node__image:hover{background:#f7fafc;border-color:#b1b7bc}.stage-node button:focus-visible{outline:2px solid #0066cc;outline-offset:2px}
</style>
