<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import type { Project } from '@/types'
import type { ApplicationIdentityDraft } from '@/utils/applicationCreation'
import { APPLICATION_NAME_LIMIT,APPLICATION_DESCRIPTION_LIMIT,applicationCreationErrors } from '@/utils/applicationCreation'
import ApplicationTagsEditor from './ApplicationTagsEditor.vue'
const props = defineProps<{modelValue:ApplicationIdentityDraft; projects:Project[]; loading:boolean; projectError:string; submitted:boolean; disabled:boolean; clone:boolean; sourceMode:'git'|'image'; tagsExpanded:boolean; active:boolean}>()
const emit = defineEmits<{'update:modelValue':[value:ApplicationIdentityDraft]; 'update:tagsExpanded':[value:boolean]; retry:[]}>()
const projectOptions = computed(()=>props.projects.map(project=>({label:project.name,value:project.id})))
const errors = computed(()=>applicationCreationErrors(props.modelValue,props.projects.map(project=>project.id)))
const root = useTemplateRef<HTMLElement>('root')
watch(() => [props.active,props.loading], async () => {
  if (!props.active || props.loading) return
  await nextTick()
  if (!root.value || root.value.contains(document.activeElement)) return
  root.value.querySelector<HTMLInputElement>(props.modelValue.projectId ? '[aria-label="新应用名称"] input' : '[aria-label="新应用项目"] input')?.focus()
}, {immediate:true,flush:'post'})
function update<K extends keyof ApplicationIdentityDraft>(field:K,value:ApplicationIdentityDraft[K]):void {emit('update:modelValue',{...props.modelValue,[field]:value})}
</script>
<template>
  <section ref="root" class="ca-identity">
    <div class="ca__icon"><t-icon name="application" size="28px" /></div>
    <div class="ca__row">
      <label class="ca__field"><span class="ca__label">项目 <em>*</em></span><t-select :model-value="modelValue.projectId" :options="projectOptions" :loading="loading" :disabled="disabled || loading" :status="submitted && errors.projectId ? 'error' : undefined" filterable aria-label="新应用项目" placeholder="选择项目" @change="update('projectId',String($event))" /><small v-if="submitted && errors.projectId" class="ca__error" role="alert">{{errors.projectId}}</small><small v-if="projectError" class="ca__error" role="alert">{{projectError}} <t-button size="small" variant="text" @click="emit('retry')">重试</t-button></small></label>
      <span class="ca__separator" aria-hidden="true">/</span>
      <label class="ca__field"><span class="ca__label">应用名称 <em>*</em></span><t-input :model-value="modelValue.name" :disabled="disabled" :status="submitted && errors.name ? 'error' : undefined" aria-label="新应用名称" placeholder="输入应用名称" @change="update('name',String($event))" /><small v-if="submitted && errors.name" class="ca__error" role="alert">{{errors.name}}</small><small class="ca__hint">3–{{ APPLICATION_NAME_LIMIT }} 位小写字母、数字或连字符。应用可部署到多个环境。</small></label>
    </div>
    <label class="ca__field"><span class="ca__label">描述</span><t-textarea :model-value="modelValue.description" :disabled="disabled" :status="submitted && errors.description ? 'error' : undefined" aria-label="新应用描述" placeholder="描述这个应用的职责" :autosize="{minRows:3,maxRows:5}" @change="update('description',String($event))" /><small v-if="submitted && errors.description" class="ca__error" role="alert">{{errors.description}}</small><small class="ca__hint">{{modelValue.description.length}} / {{APPLICATION_DESCRIPTION_LIMIT}}</small></label>
    <div class="ca__tags"><button type="button" class="ca__tags-toggle" :disabled="disabled" :aria-expanded="tagsExpanded" aria-controls="creation-application-tags" @click="emit('update:tagsExpanded',!tagsExpanded)"><t-icon :name="tagsExpanded ? 'chevron-down' : 'chevron-right'" />为应用添加标签</button><ApplicationTagsEditor v-show="tagsExpanded" id="creation-application-tags" :model-value="modelValue.tags" :disabled="disabled" :submitted="submitted" @update:model-value="update('tags',$event)" /></div>
    <div class="ca__field ca__source-mode"><span class="ca__label">应用类型</span><t-radio-group v-if="!clone" :model-value="modelValue.sourceMode" :disabled="disabled" variant="default-filled" @change="update('sourceMode',$event as 'git'|'image')"><t-radio-button value="git">源码构建</t-radio-button><t-radio-button value="image">容器镜像</t-radio-button></t-radio-group><p v-else class="ca__hint">{{sourceMode==='git'?'源码构建':'容器镜像'}}（跟随源应用）</p><small v-if="!clone" class="ca__hint">{{modelValue.sourceMode==='git'?'创建后配置 Git 仓库、构建配置、部署模板与工作流。':'创建后配置部署模板与工作流，直接使用已有镜像。'}}</small></div>
  </section>
</template>
<style scoped>
.ca-identity{display:flex;flex-direction:column;gap:16px;padding:20px;background:#fff;border:1px solid #dce1e7;border-radius:8px}.ca__icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;color:#0066cc;background:#e8f1ff;border-radius:8px}.ca__row{display:grid;grid-template-columns:minmax(170px,1fr) 12px minmax(180px,1fr);gap:8px}.ca__separator{padding-top:29px;color:#767d84;font-size:20px}.ca__field{display:flex;flex-direction:column;gap:6px;min-width:0}.ca__label{font-size:13px;color:#3b444c}.ca__label em{color:#d54941;font-style:normal}.ca__hint{margin:0;font-size:11px;line-height:17px;color:#767d84}.ca__error{font-size:11px;line-height:17px;color:#d54941}.ca__tags-toggle{display:flex;align-items:center;gap:8px;border:0;background:none;color:#000a14;padding:0;cursor:pointer;font-size:13px;font-weight:600}.ca__source-mode{border-top:1px solid #edf1f5;padding-top:16px}
</style>
