<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineTask, TaskContainerConfig } from '@/types'
import { containerConfigOf, outputPathsOf } from '@/utils/taskExecution'
import TaskMappingEditor from './TaskMappingEditor.vue'
import TaskScriptEditor from './TaskScriptEditor.vue'
const props = defineProps<{ task: PipelineTask; scriptInvalid?: boolean }>()
const emit = defineEmits<{ update: [patch: Partial<PipelineTask>] }>()
const container = computed(() => containerConfigOf(props.task))
const paths = computed(() => outputPathsOf(props.task))
function updateContainer(patch: Partial<TaskContainerConfig>): void {
  emit('update', { container: { ...container.value, ...patch } })
}
function updatePaths(value: string[]): void {
  emit('update', { outputDirectoryPaths: value, artifactPaths: value.join(',') })
}
const images = ['alpine:3.20', 'node:22-alpine', 'python:3.12-alpine', 'ubuntu:24.04'].map(value => ({ content: value, value }))
</script>
<template>
  <section class="task-execution">
    <template v-if="task.execution === 'container'">
      <div class="execution-row"><label for="task-image">Container image <em>*</em></label><div>
        <t-input id="task-image" :value="task.image" name="task-image" placeholder="repository/image:tag" @change="emit('update',{image:String($event)})"><template #suffix><t-dropdown :options="images" trigger="click" @click="emit('update',{image:String($event.value)})"><t-button variant="text" size="small" shape="square" aria-label="选择容器镜像示例"><t-icon name="chevron-down" /></t-button></t-dropdown></template></t-input>
        <p class="execution-notice"><t-icon name="info-circle" />镜像需要包含 /bin/sh 可执行文件。</p>
      </div></div>
      <div class="execution-row"><span /><t-checkbox :checked="container.mountCustomScript" aria-label="Mount custom code" @change="updateContainer({mountCustomScript:Boolean($event)})">Mount custom code</t-checkbox></div>
    </template>
    <template v-if="task.execution === 'shell' || container.mountCustomScript">
      <div class="execution-row"><label>Script <em>*</em></label><TaskScriptEditor :model-value="task.script" :context="JSON.stringify([task.id, task.execution])" :invalid="scriptInvalid" @update:model-value="emit('update',{script:$event})" /></div>
      <div v-if="task.execution === 'container'" class="execution-row"><label for="task-script-path">Mount above code at <em>*</em></label><t-input id="task-script-path" :value="container.scriptMountPath" name="task-script-path" placeholder="/directory/filename.sh" @change="updateContainer({scriptMountPath:String($event)})" /></div>
    </template>
    <template v-if="task.execution === 'container'">
      <div class="execution-row"><label for="task-command">Command</label><t-input id="task-command" :value="container.command" name="task-command" placeholder="例如 /bin/sh" @change="updateContainer({command:String($event)})" /></div>
      <div class="execution-row"><label for="task-args">Args</label><div><t-input id="task-args" :value="container.args.join(',')" name="task-args" placeholder="例如 -c,echo hello" @change="updateContainer({args:String($event) ? String($event).split(',') : []})" /><p>多个参数用逗号分隔，逗号会分成独立参数。</p></div></div>
      <div class="execution-row"><span>Port mapping</span><TaskMappingEditor :config="container" kind="ports" @update="updateContainer" /></div>
      <div class="execution-row"><span>Mount code to container</span><t-radio-group :value="container.mountSource" aria-label="Mount code to container" @change="updateContainer({mountSource:Boolean($event),sourceMountPath:container.sourceMountPath || '/sourcecode'})"><t-radio :value="true">True</t-radio><t-radio :value="false">False</t-radio></t-radio-group></div>
      <div v-if="container.mountSource" class="execution-row"><label for="task-source-path">Mount code at <em>*</em></label><t-input id="task-source-path" :value="container.sourceMountPath" name="task-source-path" placeholder="/sourcecode" @change="updateContainer({sourceMountPath:String($event)})" /></div>
      <div class="execution-row"><span>Mount directory from host</span><t-radio-group :value="container.mountHost" aria-label="Mount directory from host" @change="updateContainer({mountHost:Boolean($event)})"><t-radio :value="true">True</t-radio><t-radio :value="false">False</t-radio></t-radio-group></div>
      <div v-if="container.mountHost" class="execution-row"><span /><TaskMappingEditor :config="container" kind="paths" @update="updateContainer" /></div>
    </template>
    <p v-if="task.execution === 'shell'" class="execution-source-hint">源码在执行环境的 /devtroncd 目录中可用。</p>
    <div class="execution-row"><label for="task-directory">工作目录</label><t-input id="task-directory" :value="task.workingDirectory" name="task-directory" @change="emit('update',{workingDirectory:String($event)})" /></div>
    <div class="execution-row"><span>Output directory path</span><div class="execution-outputs">
      <t-button variant="text" theme="primary" size="small" @click="updatePaths(['',...paths])"><template #icon><t-icon name="add" /></template>Add path</t-button>
      <div v-for="(path,index) in paths" :key="index" class="execution-output-row"><t-input :value="path" :aria-label="`产物路径 ${index + 1}`" placeholder="Enter directory path" @change="updatePaths(paths.map((value,i) => i === index ? String($event) : value))" /><t-button variant="text" size="small" shape="square" :aria-label="`删除产物路径 ${index + 1}`" @click="updatePaths(paths.filter((_,i) => i !== index))"><t-icon name="close" /></t-button></div>
      <p>收集脚本产生的测试报告或文件。不能使用保留目录 /devtroncd。</p>
    </div></div>
  </section>
</template>
<style scoped>
.task-execution{display:flex;flex-direction:column;gap:18px;padding-top:8px;font-size:12px}.execution-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:start}.execution-row>label,.execution-row>span{padding-top:7px;font-weight:500;line-height:18px}.execution-row em{color:var(--tk-danger);font-style:normal}.execution-row p,.execution-source-hint{margin:6px 0 0;color:var(--tk-text-2);font-size:12px;line-height:18px}.execution-notice{display:flex;align-items:center;gap:6px;background:#eaf4ff;padding:8px;border-radius:4px}.execution-row .t-radio-group{display:flex;gap:20px;min-height:32px;align-items:center}.execution-row :deep(.t-radio){margin:0}.execution-outputs{display:flex;flex-direction:column;gap:8px;min-width:0}.execution-outputs>.t-button{align-self:flex-start;margin-left:-8px}.execution-output-row{display:flex;gap:8px;align-items:center}.execution-output-row :deep(.t-input__wrap){flex:1;min-width:0}@media(max-width:1100px){.execution-row{grid-template-columns:130px minmax(0,1fr);gap:12px}}
</style>
