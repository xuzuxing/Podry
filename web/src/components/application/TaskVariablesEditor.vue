<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineTask, TaskInputVariable, TaskOutputVariable } from '@/types'
import { globalTaskVariables, inputVariableError, taskReferences } from '@/utils/pipelineTasks'

const props = defineProps<{ inputs: TaskInputVariable[]; outputs: TaskOutputVariable[]; previous: PipelineTask[]; locked?: boolean; hideOutputs?: boolean }>()
const emit = defineEmits<{ 'update:inputs': [variables: TaskInputVariable[]]; 'update:outputs': [variables: TaskOutputVariable[]] }>()
const formats = [{label:'String',value:'string'},{label:'Number',value:'number'},{label:'Boolean',value:'boolean'},{label:'Date',value:'date'}]
const references = computed(() => taskReferences(props.previous))
function input(index: number, patch: Partial<TaskInputVariable>): void {
  emit('update:inputs', props.inputs.map((item, i) => i === index ? { ...item, ...patch } : item))
}
function output(index: number, patch: Partial<TaskOutputVariable>): void {
  emit('update:outputs', props.outputs.map((item, i) => i === index ? { ...item, ...patch } : item))
}
function reference(index: number, value: string): void {
  const item = references.value.find(item => item.value === value)
  input(index, { refTaskId: item?.taskId, refVariable: item?.variable, value: '' })
}
</script>
<template>
  <section class="task-variables task-variables--inputs">
    <h4>Input variables</h4><p>输入变量以环境变量形式注入脚本，可引用全局变量或前序任务输出。</p>
    <div class="task-variable-head"><span>VARIABLE</span><span>TYPE</span><span>VALUE</span><span /></div>
    <div v-for="(variable,index) in inputs" :key="index" class="task-variable-row">
      <t-input :value="variable.key" :readonly="locked" placeholder="变量名" :aria-label="`输入变量 ${index + 1} 名称`" @change="input(index,{key:String($event)})" />
      <t-select :value="variable.format ?? 'string'" :disabled="locked" :options="formats" :aria-label="`输入变量 ${index + 1} 类型`" @change="input(index,{format:$event as TaskInputVariable['format']})" />
      <div class="task-variable-value">
        <t-select :value="variable.source ?? 'literal'" :aria-label="`输入变量 ${index + 1} 来源`" :options="[{label:'自定义值',value:'literal'},{label:'全局变量',value:'global'},{label:'前序任务输出',value:'task'}]" @change="input(index,{source:$event as TaskInputVariable['source'],value:'',refTaskId:undefined,refVariable:undefined})" />
        <t-select v-if="variable.source === 'task'" :value="variable.refTaskId && variable.refVariable ? JSON.stringify([variable.refTaskId,variable.refVariable]) : ''" :options="references.filter(item=>item.format===(variable.format ?? 'string'))" placeholder="选择前序输出" :aria-label="`输入变量 ${index + 1} 引用`" @change="reference(index,String($event))" />
        <t-select v-else-if="variable.source === 'global'" :value="variable.value" :options="globalTaskVariables.filter(item=>item.format===(variable.format ?? 'string')).map(item=>({label:item.key,value:item.key}))" placeholder="选择全局变量" :aria-label="`输入变量 ${index + 1} 全局变量`" @change="input(index,{value:String($event)})" />
        <t-input v-else :value="variable.value" placeholder="变量值" :aria-label="`输入变量 ${index + 1} 值`" @change="input(index,{value:String($event)})" />
        <small v-if="inputVariableError(variable,previous)" class="task-variable-error">{{ inputVariableError(variable,previous) }}</small>
      </div>
      <t-button v-if="!locked" variant="text" shape="square" :aria-label="`删除输入变量 ${index + 1}`" @click="emit('update:inputs',inputs.filter((_,i)=>i!==index))"><t-icon name="delete" /></t-button>
    </div>
    <t-button v-if="!locked" size="small" variant="text" @click="emit('update:inputs',[...inputs,{key:'',value:'',format:'string',source:'literal'}])">+ 添加输入变量</t-button>
    <p v-else-if="!inputs.length">此插件没有输入参数。</p>
  </section>
  <slot />
  <section v-if="!hideOutputs" class="task-variables task-variables--outputs">
    <h4>Output variables</h4><p>在脚本中通过 export 设置输出变量，后续任务可将其作为输入。</p>
    <div class="task-variable-head"><span>VARIABLE</span><span>TYPE</span><span>DESCRIPTION</span><span /></div>
    <div v-for="(variable,index) in outputs" :key="index" class="task-variable-row">
      <t-input :value="variable.key" :readonly="locked" placeholder="变量名" :aria-label="`输出变量 ${index + 1} 名称`" @change="output(index,{key:String($event)})" />
      <t-select :value="variable.format ?? 'string'" :disabled="locked" :options="formats" :aria-label="`输出变量 ${index + 1} 类型`" @change="output(index,{format:$event as TaskOutputVariable['format']})" />
      <t-input :value="variable.description ?? ''" :readonly="locked" placeholder="变量说明" :aria-label="`输出变量 ${index + 1} 说明`" @change="output(index,{description:String($event)})" />
      <t-button v-if="!locked" variant="text" shape="square" :aria-label="`删除输出变量 ${index + 1}`" @click="emit('update:outputs',outputs.filter((_,i)=>i!==index))"><t-icon name="delete" /></t-button>
    </div>
    <t-button v-if="!locked" size="small" variant="text" @click="emit('update:outputs',[...outputs,{key:'',format:'string',description:''}])">+ 添加输出变量</t-button>
  </section>
</template>
<style scoped>
.task-variables{display:flex;flex-direction:column;gap:10px}.task-variables h4{margin:0;font-size:13px}.task-variables p{margin:0;font-size:12px;color:var(--tk-text-2);line-height:18px}.task-variable-head,.task-variable-row{display:grid;grid-template-columns:minmax(100px,1fr) 100px minmax(180px,1.6fr) 32px;gap:8px;align-items:start}.task-variable-head{font-size:10px;color:var(--tk-text-2)}.task-variable-value{display:flex;flex-direction:column;gap:6px}.task-variable-error{color:var(--tk-danger,#d54941);line-height:18px}.task-variables :deep(.t-input){min-width:0}
</style>
