<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeploymentStageSettings as StageSettings, PipelineTask, StageResourceReferences } from '@/types'
import DeploymentStageSettings from '@/components/application/DeploymentStageSettings.vue'
import StageResourcePicker from '@/components/application/StageResourcePicker.vue'
import type { StageResourceOption } from '@/utils/stageResources'
import TaskCatalogPanel from '@/components/application/TaskCatalogPanel.vue'
import PipelineTaskDetail from '@/components/application/PipelineTaskDetail.vue'

const props = defineProps<{
  modelValue: PipelineTask[]
  stage: 'pre' | 'post'
  isCi: boolean
  preceding: PipelineTask[]
  errors: Record<string, string[]>
  submitted: boolean
  resources: StageResourceReferences
  resourceOptions: StageResourceOption[]
  resourceScope: string
  settings: StageSettings
  workerEnabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [tasks: PipelineTask[]]; move: [id: string]; 'update:resources': [value: StageResourceReferences]; 'update:settings': [value: StageSettings] }>()
const activeId = ref('')
const addOpen = ref(false)
const draggedId = ref('')
const task = computed(() => props.modelValue.find(item => item.id === activeId.value) ?? props.modelValue[0])
const previous = computed(() => [...props.preceding, ...props.modelValue.slice(0, props.modelValue.findIndex(item => item.id === task.value?.id))])
function update(patch: Partial<PipelineTask>): void {
  if (task.value) emit('update:modelValue', props.modelValue.map(item => item.id === task.value!.id ? { ...item, ...patch } : item))
}
function add(value: PipelineTask): void {
  emit('update:modelValue', [...props.modelValue, value])
  activeId.value = value.id
  addOpen.value = false
}
function reorder(id: string, offset: number): void {
  const tasks = [...props.modelValue]
  const index = tasks.findIndex(item => item.id === id)
  if (index < 0 || index + offset < 0 || index + offset >= tasks.length) return
  const [item] = tasks.splice(index, 1)
  tasks.splice(index + offset, 0, item!)
  emit('update:modelValue', tasks)
}
function drop(id: string): void {
  const from = props.modelValue.findIndex(item=>item.id===draggedId.value)
  const to = props.modelValue.findIndex(item=>item.id===id)
  if (from >= 0 && to >= 0) reorder(draggedId.value, to-from)
  draggedId.value=''
}
</script>
<template>
  <div class="stage-editor">
    <aside class="stage-task-list">
      <strong>{{ stage === 'pre' ? (isCi ? 'Pre-build' : 'Pre-deployment') : (isCi ? 'Post-build' : 'Post-deployment') }}</strong>
      <p class="u-muted">按顺序执行任务</p>
      <div v-for="(item,index) in modelValue" :key="item.id" class="stage-task" :class="{active:task?.id===item.id}" draggable="true" @dragstart="draggedId=item.id" @dragover.prevent @drop.prevent="drop(item.id)" @dragend="draggedId=''">
        <button class="stage-task__name" :title="item.name" @click="activeId=item.id;addOpen=false"><t-icon name="move" /><span>{{ index + 1 }}. {{ item.name }}</span><t-icon v-if="submitted && errors[item.id]?.length" name="error-circle" class="stage-task__error" /></button>
        <t-dropdown trigger="click" :options="[{content:'上移',value:'up',disabled:index===0},{content:'下移',value:'down',disabled:index===modelValue.length-1},{content:stage==='pre'?'移到后置阶段':'移到前置阶段',value:'move'},{content:'删除任务',value:'delete',theme:'error'}]" @click="$event.value === 'up' ? reorder(item.id,-1) : $event.value === 'down' ? reorder(item.id,1) : $event.value === 'move' ? emit('move',item.id) : emit('update:modelValue',modelValue.filter(task=>task.id!==item.id))">
          <t-button size="small" shape="square" variant="text" :aria-label="`${item.name} 任务操作`"><t-icon name="more" /></t-button>
        </t-dropdown>
      </div>
      <t-button variant="outline" size="small" @click="addOpen=true"><template #icon><t-icon name="add" /></template>添加任务</t-button>
      <DeploymentStageSettings v-if="!isCi" :key="stage" :model-value="settings" :stage="stage" :worker-enabled="workerEnabled" :submitted="submitted" @update:model-value="emit('update:settings',$event)">
        <StageResourcePicker :model-value="resources" :options="resourceOptions" :scope="resourceScope" @update:model-value="emit('update:resources',$event)" />
      </DeploymentStageSettings>
      <p class="stage-task-list__hint">拖动可调整顺序。调整或移除任务后，请检查后续任务的输出引用。</p>
    </aside>
    <TaskCatalogPanel v-if="addOpen" :count="modelValue.length" @select="add" @cancel="addOpen=false" />
    <PipelineTaskDetail v-else-if="task" :key="task.id" :task="task" :previous="previous" :stage="stage" :is-ci="isCi" :errors="errors[task.id] ?? []" :submitted="submitted" @update="update" />
    <section v-else class="stage-task-empty"><t-icon name="code" size="48px" /><h3>此阶段还没有任务</h3><p>添加自定义脚本，配置流水线的前置或后置步骤。</p><t-button theme="primary" @click="addOpen=true">添加任务</t-button></section>
  </div>
</template>
<style scoped>
.stage-editor{flex:1;width:100%;height:100%;overflow:hidden}.stage-editor>.stage-task-list{overflow:auto}.stage-editor>.stage-task-detail{overflow:auto}.stage-task__name:focus-visible{outline:2px solid var(--tk-primary)}
.stage-editor{display:flex;min-height:0;margin:0}.stage-task-list{width:220px;flex:none;display:flex;flex-direction:column;gap:12px;padding:20px 12px;background:#f7f9fc;border-right:1px solid var(--tk-border)}.stage-task-list p{font-size:12px;margin:0;line-height:18px}.stage-task{display:flex;align-items:center;border:1px solid transparent;border-radius:4px}.stage-task.active{background:var(--tk-primary-weak);border-color:#c6e3ff}.stage-task__name{display:flex;align-items:center;gap:6px;flex:1;min-width:0;padding:10px 6px;font:inherit;white-space:nowrap;background:transparent;border:0;cursor:pointer}.stage-task__name span{overflow:hidden;text-overflow:ellipsis}.stage-task__name>.t-icon{flex:none}.stage-task__error{color:#d54941}.stage-task-list__hint{color:var(--tk-text-2);padding-top:12px;border-top:1px solid var(--tk-border)}.stage-task-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;flex:1;padding:32px;color:var(--tk-text-2)}.stage-task-empty p{margin:0}
</style>
