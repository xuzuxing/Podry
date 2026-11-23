<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PipelineTask } from '@/types'
import { taskCatalog, applyTaskPlugin } from '@/mock/taskCatalog'
import TaskVariablesEditor from './TaskVariablesEditor.vue'
import TaskConditionsEditor from './TaskConditionsEditor.vue'
import TaskExecutionFields from './TaskExecutionFields.vue'
import { newContainerConfig } from '@/utils/taskExecution'

const props = defineProps<{ task: PipelineTask; previous: PipelineTask[]; isCi: boolean; stage: 'pre' | 'post'; errors: string[]; submitted: boolean }>()
const emit = defineEmits<{ update: [patch: Partial<PipelineTask>] }>()
const plugin = computed(() => taskCatalog.find(item=>item.id===props.task.plugin?.id))
const containerConfirm = ref(false)
function changeExecution(value: PipelineTask['execution']): void {
  if (value === 'container' && ((props.task.outputs?.length ?? 0) || props.task.resultRule)) { containerConfirm.value=true; return }
  emit('update',{execution:value, ...(value === 'container' && !props.task.container ? {container:newContainerConfig()} : {})})
}
function changeVersion(value: string): void {
  const version = plugin.value?.versions.find(item=>item.version===value)
  if (plugin.value && version) emit('update', applyTaskPlugin(props.task,plugin.value,version))
}
</script>
<template>
  <section class="stage-task-detail">
    <header class="task-detail-header"><t-icon :name="plugin?'extension':'code'" size="24px" /><div><strong>{{ plugin?.name ?? 'Custom script' }}</strong><p>{{ plugin?.description ?? '配置脚本、变量与执行条件' }}</p></div><t-select v-if="plugin" :value="task.plugin?.version" :options="plugin.versions.map(item=>({label:item.version,value:item.version}))" aria-label="插件版本" @change="changeVersion(String($event))" /></header>
    <t-alert v-if="submitted && errors.length" theme="error" :message="errors.join('；')" />
    <label class="task-field">任务名称<t-input :value="task.name" name="task-name" @change="emit('update',{name:String($event)})" /></label>
    <label class="task-field">Description<t-input :value="task.description ?? ''" name="task-description" placeholder="任务说明" @change="emit('update',{description:String($event)})" /></label>
    <t-checkbox v-if="isCi && stage==='post'" :checked="task.triggerIfParentStageFail ?? false" @change="emit('update',{triggerIfParentStageFail:Boolean($event)})">Trigger even if build fails</t-checkbox>
    <div v-if="!plugin" class="stage-fields"><label class="task-field">执行方式<t-radio-group :value="task.execution" @change="changeExecution($event as PipelineTask['execution'])"><t-radio value="shell">Shell</t-radio><t-radio value="container">Container</t-radio></t-radio-group></label><label class="task-field">运行条件<t-select :value="task.condition" aria-label="任务运行条件" :options="[{label:'前序任务成功时',value:'success'},{label:'前序任务失败时',value:'failure'},{label:'始终执行',value:'always'}]" @change="emit('update',{condition:$event as PipelineTask['condition']})" /></label></div>
    <TaskVariablesEditor :inputs="task.variables" :outputs="task.outputs ?? []" :previous="previous" :locked="Boolean(plugin)" :hide-outputs="task.execution==='container'" @update:inputs="emit('update',{variables:$event})" @update:outputs="emit('update',{outputs:$event})">
      <TaskConditionsEditor :model-value="task.triggerRule" kind="trigger" :variables="task.variables" @update:model-value="emit('update',{triggerRule:$event})" />
      <TaskExecutionFields v-if="!plugin" :task="task" :script-invalid="submitted && errors.includes('请填写任务脚本')" @update="emit('update',$event)" />
    </TaskVariablesEditor>
    <TaskConditionsEditor v-if="task.execution==='shell'" :model-value="task.resultRule" kind="result" :variables="task.outputs ?? []" @update:model-value="emit('update',{resultRule:$event})" />
    <t-dialog v-model:visible="containerConfirm" header="切换到 Container" confirm-btn="切换并清除" @confirm="emit('update',{execution:'container',container:task.container ?? newContainerConfig(),outputs:[],resultRule:undefined});containerConfirm=false"><p>Container 任务不提供脚本输出变量。切换将清除此任务的输出变量和通过/失败条件，后续引用需要重新选择。</p></t-dialog>
  </section>
</template>
<style scoped>
.stage-task-detail{display:flex;flex-direction:column;gap:20px;flex:1;min-width:0;padding:20px}.task-detail-header{display:flex;align-items:center;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--tk-border)}.task-detail-header>div{flex:1;min-width:0}.task-detail-header p{margin:4px 0 0;font-size:12px;color:var(--tk-text-2)}.task-detail-header :deep(.t-select__wrap){max-width:130px}.stage-task-detail .task-field{display:flex;flex-direction:column;gap:8px;font-weight:500;font-size:12px}.stage-fields{display:flex;gap:24px}.stage-fields>.task-field{flex:1}.stage-task-detail>.task-variables,.stage-task-detail>.task-conditions{padding-top:20px;border-top:1px solid var(--tk-border)}
</style>
