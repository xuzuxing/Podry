<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { MaterialSelectionState } from '@/composables/useBuildMaterials'
import { repositoryName } from '@/utils/gitMaterials'
import { sourceMatches } from '@/utils/pipelineBuild'

const props = defineProps<{ visible: boolean; states: MaterialSelectionState[]; pipelineName: string; saving: boolean; error: string }>()
const emit = defineEmits<{ close: []; submit: [branches: Array<{ gitMaterialId: string; branch: string }>] }>()
const values = ref<Record<string, string>>({})
const touched = shallowRef(false)
const sources = computed(() => props.states.filter(state => state.source.type === 'regex'))
const invalid = computed(() => sources.value.some(state => !sourceMatches(state.source, values.value[state.material.id]?.trim() ?? '')))
watch(() => props.visible, visible => {
  if (visible) { values.value = Object.fromEntries(sources.value.map(state => [state.material.id, state.branch])); touched.value = false }
})
function submit() {
  touched.value = true
  if (invalid.value || props.saving) return
  emit('submit', sources.value.map(state => ({ gitMaterialId: state.material.id, branch: values.value[state.material.id]!.trim() })))
}
</script>

<template>
  <t-dialog :visible="visible" :header="`${pipelineName} / 设置分支`" width="600px" dialog-class-name="build-branch-dialog" :close-on-overlay-click="false" :close-on-esc-keydown="!saving" @close="!saving && emit('close')">
    <form id="build-branch-form" class="build-branch-form" @submit.prevent="submit">
      <p class="build-branch-form__info">将从指定分支读取提交，之后可以再次修改。</p>
      <div v-for="state in sources" :key="state.material.id" class="build-branch-form__row">
        <strong><t-icon name="code" size="24px" /> {{ repositoryName(state.material.repositoryUrl) }}</strong>
        <p>分支名称需匹配正则 <b>{{ state.source.value }}</b></p>
        <t-input v-model="values[state.material.id]" :aria-label="`设置构建分支 ${state.material.id}`" placeholder="输入匹配正则的分支名称" :disabled="saving" :status="touched && !sourceMatches(state.source, values[state.material.id]?.trim() ?? '') ? 'error' : undefined" />
        <p v-if="touched && !sourceMatches(state.source, values[state.material.id]?.trim() ?? '')" class="build-branch-form__error">{{ values[state.material.id]?.trim() ? '分支名称不匹配配置的正则表达式' : '请输入分支名称' }}</p>
      </div>
      <p v-if="error" role="alert" class="build-branch-form__error">{{ error }}</p>
    </form>
    <template #footer><t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button><t-button theme="primary" type="submit" form="build-branch-form" :loading="saving">读取提交 <t-icon name="enter" /></t-button></template>
  </t-dialog>
</template>

<style scoped>
.build-branch-form{font-size:13px}.build-branch-form__info{margin:0;padding:12px 16px;background:#f2f7fd;border-top:1px solid #e6e9ef;border-bottom:1px solid #e6e9ef;line-height:20px}.build-branch-form__row{padding:20px 0;border-bottom:1px solid #e6e9ef}.build-branch-form__row strong{display:flex;align-items:center;gap:12px;overflow-wrap:anywhere}.build-branch-form__row p{padding-left:36px;color:#596168;overflow-wrap:anywhere}.build-branch-form__row :deep(.t-input__wrap){margin-left:36px;width:calc(100% - 36px)}.build-branch-form__error{color:#d54941!important;font-size:12px}.build-branch-form__row p:last-child{margin-bottom:0}
</style>
