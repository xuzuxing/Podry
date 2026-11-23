<script setup lang="ts">
import { computed } from 'vue'
import { applicationTagErrors } from '@/utils/applicationCreation'
import type { ApplicationTagDraft } from '@/utils/applicationCreation'
const props = defineProps<{modelValue: ApplicationTagDraft[]; disabled: boolean; submitted: boolean}>()
const emit = defineEmits<{'update:modelValue':[rows:ApplicationTagDraft[]]}>()
const errors = computed(() => applicationTagErrors(props.modelValue))
function update(index: number, field: 'key' | 'value' | 'propagate', value: string | boolean): void {
  emit('update:modelValue',props.modelValue.map((row,i) => i === index ? {...row,[field]:value} : row))
}
function add(): void { emit('update:modelValue',[...props.modelValue,{id:Math.max(0,...props.modelValue.map(row=>row.id))+1,key:'',value:'',propagate:false}]) }
function remove(index: number): void { emit('update:modelValue', props.modelValue.filter((_,i)=>i!==index)) }
</script>
<template>
  <div class="application-tags">
    <div class="application-tags__row application-tags__head"><span>Key</span><span>Value</span><span>传播到资源</span><span /></div>
    <div v-for="(row,index) in modelValue" :key="row.id" class="application-tags__row">
      <div><t-input :model-value="row.key" :disabled="disabled" :aria-label="`标签键 ${index+1}`" placeholder="例如 team" :status="submitted && errors[index]?.key ? 'error' : undefined" @change="update(index,'key',String($event))" /><small v-if="submitted && errors[index]?.key" class="tag-error" role="alert">{{ errors[index]?.key }}</small></div>
      <div><t-input :model-value="row.value" :disabled="disabled" :aria-label="`标签值 ${index+1}`" placeholder="例如 platform" :status="submitted && errors[index]?.value ? 'error' : undefined" @change="update(index,'value',String($event))" /><small v-if="submitted && errors[index]?.value" class="tag-error" role="alert">{{ errors[index]?.value }}</small></div>
      <t-checkbox :checked="row.propagate" :disabled="disabled" :aria-label="`传播标签 ${index+1}`" @change="update(index,'propagate',Boolean($event))" />
      <t-button variant="text" theme="default" :disabled="disabled" :aria-label="`删除标签 ${index+1}`" @click="remove(index)"><t-icon name="delete" /></t-button>
    </div>
    <t-button variant="text" :disabled="disabled" @click="add"><template #icon><t-icon name="add" /></template>添加标签</t-button>
    <p class="application-tags__notice">Mock 仅记录标签与传播选项，尚未写入 Kubernetes 资源。</p>
  </div>
</template>
<style scoped>
.application-tags__row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(100px,1fr) 86px 32px;gap:8px;align-items:start;padding:8px 0;font-size:12px}.application-tags__head{color:#596168;border-bottom:1px solid #dce1e7}.application-tags__row>.t-checkbox{margin-top:8px;justify-self:center}.tag-error{display:block;font-size:11px;line-height:16px;color:#d54941;margin-top:4px}.application-tags__notice{margin:6px 0 0;font-size:11px;color:#767d84;line-height:18px}
</style>
