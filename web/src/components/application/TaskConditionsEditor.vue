<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TaskConditionGroup, TaskOutputVariable } from '@/types'

const props = defineProps<{ modelValue?: TaskConditionGroup; kind: 'trigger' | 'result'; variables: TaskOutputVariable[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: TaskConditionGroup | undefined] }>()
const expanded = ref(Boolean(props.modelValue))
watch(() => props.modelValue, value => { if (value) expanded.value = true })
const modes = computed(() => props.kind === 'trigger' ? [{value:'trigger',label:'Set trigger conditions'},{value:'skip',label:'Set skip conditions'}] : [{value:'pass',label:'Set pass conditions'},{value:'fail',label:'Set fail conditions'}])
const options = computed(() => props.variables.filter(item=>item.key).map(item=>({label:item.key,value:item.key})))
function setMode(mode: TaskConditionGroup['mode']): void {
  emit('update:modelValue', {mode,conditions:props.modelValue?.conditions ?? [{id:crypto.randomUUID(),variable:'',operator:'==',value:''}]})
}
function change(index: number, patch: Partial<TaskConditionGroup['conditions'][number]>): void {
  if (props.modelValue) emit('update:modelValue', {...props.modelValue,conditions:props.modelValue.conditions.map((item,i)=>i===index?{...item,...patch}:item)})
}
function operators(variable: string) {
  const format = props.variables.find(item=>item.key===variable)?.format
  return (format === 'number' || format === 'date' ? ['==','!=','<','>','<=','>='] : ['==','!=']).map(value=>({label:value,value}))
}
function addCondition(): void {
  if (props.modelValue) emit('update:modelValue',{...props.modelValue,conditions:[...props.modelValue.conditions,{id:crypto.randomUUID(),variable:'',operator:'==',value:''}]})
}
</script>
<template>
  <section class="task-conditions" :class="`task-conditions--${kind}`">
    <button class="task-conditions__toggle" :aria-expanded="expanded" @click="expanded=!expanded"><strong>{{ kind==='trigger'?'Trigger / Skip Condition':'Pass / Failure Condition' }}</strong><t-tag v-if="modelValue" size="small">{{ modelValue.conditions.length }} 条</t-tag><t-icon :name="expanded?'chevron-up':'chevron-down'" /></button>
    <template v-if="expanded">
      <div class="task-conditions__choices"><t-radio-group :value="modelValue?.mode ?? ''" @change="setMode($event as TaskConditionGroup['mode'])"><t-radio v-for="mode in modes" :key="mode.value" :value="mode.value">{{ mode.label }}</t-radio></t-radio-group><t-button v-if="modelValue" variant="text" size="small" @click="emit('update:modelValue',undefined)">清除条件</t-button></div>
      <p>{{ kind==='trigger'?'使用输入变量决定触发或跳过任务。':'使用输出变量决定阶段通过或失败。' }}</p>
      <div v-for="(condition,index) in modelValue?.conditions ?? []" :key="condition.id" class="task-condition-row">
        <t-select :value="condition.variable" :options="options" placeholder="选择变量" :aria-label="`${kind} 条件 ${index + 1} 变量`" @change="change(index,{variable:String($event),operator:'=='})" />
        <t-select :value="condition.operator" :options="operators(condition.variable)" :aria-label="`${kind} 条件 ${index + 1} 运算符`" @change="change(index,{operator:$event as typeof condition.operator})" />
        <t-input :value="condition.value" placeholder="比较值" :aria-label="`${kind} 条件 ${index + 1} 值`" @change="change(index,{value:String($event)})" />
        <t-button variant="text" shape="square" :aria-label="`删除 ${kind} 条件 ${index + 1}`" @click="emit('update:modelValue',modelValue!.conditions.length===1?undefined:{...modelValue!,conditions:modelValue!.conditions.filter((_,i)=>i!==index)})"><t-icon name="delete" /></t-button>
      </div>
      <t-button v-if="modelValue" variant="text" size="small" @click="addCondition">+ 添加条件</t-button>
    </template>
  </section>
</template>
<style scoped>
.task-conditions{display:flex;flex-direction:column;gap:12px}.task-conditions__toggle{display:flex;align-items:center;gap:10px;padding:0;font:inherit;border:0;background:transparent;text-align:left;cursor:pointer}.task-conditions__toggle>.t-icon:last-child{margin-left:auto}.task-conditions__choices{display:flex;align-items:center;justify-content:space-between;gap:8px}.task-conditions__choices :deep(.t-radio){margin:0 12px 0 0;font-size:12px}.task-conditions p{margin:0;color:var(--tk-text-2);font-size:12px}.task-condition-row{display:grid;grid-template-columns:minmax(120px,1fr) 76px minmax(100px,1fr) 32px;gap:8px}
</style>
