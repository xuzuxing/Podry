<script setup lang="ts">
import { computed } from 'vue'
import type { CISource, GitMaterial } from '@/types'
import { repositoryName } from '@/utils/gitMaterials'
import { sourceError } from '@/utils/pipelineBuild'
import { isWebhookSource, newSource, sourceContextError, sourceTypeOptions } from '@/utils/gitSources'
import WebhookSourceFields from './WebhookSourceFields.vue'

const props = defineProps<{ modelValue: CISource[]; materials: GitMaterial[]; disabled: boolean; submitted: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: CISource[]] }>()
const contextError = computed(() => sourceContextError(props.modelValue, props.materials))
const rows = computed(() => props.modelValue.map(source => {
  const material = props.materials.find(item => item.id === source.gitMaterialId)
  return { source, material, name: repositoryName(material?.repositoryUrl ?? ''), options: sourceTypeOptions(material, props.materials.length, source.type) }
}))
function patch(id: string, value: Partial<CISource>) {
  emit('update:modelValue', props.modelValue.map((source) => source.gitMaterialId === id ? { ...source, ...value, ...(source.type === 'regex' && value.value !== undefined ? {selectedBranch: undefined} : {}) } : source))
}
function changeType(source: CISource, type: CISource['type'], branch: string) {
  emit('update:modelValue', props.modelValue.map(item => item.gitMaterialId === source.gitMaterialId ? newSource(source, type, branch) : item))
}
</script>

<template>
  <section class="pipeline-sources">
    <h3>选择代码源</h3>
    <p v-if="contextError" class="pipeline-source__error">{{ contextError }}</p>
    <div v-for="{ source, material, name, options } in rows" :key="source.gitMaterialId" class="pipeline-source">
      <p :title="material?.repositoryUrl"><t-icon name="code" /> {{ name }}</p>
      <div class="pipeline-source__fields">
        <label><span>源类型 <em>*</em></span><t-select :value="source.type" :aria-label="'源类型 ' + source.gitMaterialId" :options="options" :disabled="disabled" @change="changeType(source, $event as CISource['type'], material?.branch ?? 'main')" /></label>
        <label v-if="!isWebhookSource(source)"><span>{{ source.type === 'regex' ? '分支正则' : '分支名称' }} <em>*</em></span><t-input :value="source.value" :aria-label="'分支 ' + source.gitMaterialId" :placeholder="source.type === 'regex' ? '^feature/.*' : 'main'" :disabled="disabled" @change="patch(source.gitMaterialId, {value: String($event)})" /></label>
      </div>
      <WebhookSourceFields v-if="isWebhookSource(source)" :source="source" :disabled="disabled" @change="patch(source.gitMaterialId, { filters: $event })" />
      <p v-if="submitted && sourceError(source)" class="pipeline-source__error">{{ sourceError(source) }}</p>
      <p v-else-if="source.type === 'regex'" class="pipeline-source__info">触发构建时可以选择匹配此正则的分支。</p>
    </div>
  </section>
</template>

<style scoped>
.pipeline-sources{margin:20px 0}.pipeline-sources h3{margin:0 0 12px;font-size:14px;font-weight:600}.pipeline-source{padding:0 0 20px}.pipeline-source>p:first-child{display:flex;align-items:center;gap:8px;margin:0 0 12px;overflow-wrap:anywhere}.pipeline-source__fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pipeline-source__fields label{display:flex;flex-direction:column;gap:8px;font-size:13px}.pipeline-source em{color:#d54941;font-style:normal}.pipeline-source__info,.pipeline-source__error{font-size:12px;margin:8px 0 0}.pipeline-source__info{padding:8px 12px;background:#e7f2ff;color:#3b444c}.pipeline-source__error{color:#d54941}
</style>
