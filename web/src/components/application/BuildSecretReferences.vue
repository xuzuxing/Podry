<script setup lang="ts">
import type { BuildSecretReference } from '@/types'

const props = defineProps<{ modelValue: BuildSecretReference[]; kind: 'secrets' | 'ssh'; disabled: boolean; error?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildSecretReference[]] }>()
const sources = [{ label: '构建基础设施', value: 'BUILD_INFRA' }, { label: '源码', value: 'SOURCE_CODE' }]
function update(index: number, field: keyof BuildSecretReference, value: unknown) {
  emit('update:modelValue', props.modelValue.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: String(value) } : item))
}
function add() { emit('update:modelValue', [...props.modelValue, { type: 'BUILD_INFRA', id: '', secretName: '', key: '' }]) }
</script>

<template>
  <section class="build-references" :data-kind="kind">
    <h3>{{ kind === 'ssh' ? 'SSH 密钥引用' : '构建 Secrets' }}</h3>
    <p>{{ kind === 'ssh' ? '供 Dockerfile 中 RUN --mount=type=ssh 引用。' : '供 Dockerfile 中 RUN --mount=type=secret 引用。' }}仅登记引用，不输入凭据明文。</p>
    <div v-for="(reference, index) in modelValue" :key="index" class="build-reference">
      <div class="build-reference__head"><strong>{{ kind === 'ssh' ? 'SSH' : 'Secret' }} {{ index + 1 }}</strong><t-button v-if="!disabled" variant="text" :aria-label="'删除 ' + kind + ' 引用 ' + (index + 1)" @click="emit('update:modelValue', modelValue.filter((_, itemIndex) => itemIndex !== index))"><t-icon name="delete" /></t-button></div>
      <div class="build-reference__fields">
        <label><span>来源</span><t-select :value="reference.type" :options="sources" :disabled="disabled" :aria-label="kind + ' 来源 ' + (index + 1)" @change="update(index, 'type', $event)" /></label>
        <label><span>引用 ID <em>*</em></span><t-input :value="reference.id" :name="kind + 'Id'" :aria-label="kind + ' 引用 ID ' + (index + 1)" placeholder="Dockerfile 挂载 ID" :disabled="disabled" @change="update(index, 'id', $event)" /></label>
        <label><span>Secret 名称 <em>*</em></span><t-input :value="reference.secretName" :name="kind + 'Name'" :aria-label="kind + ' 名称 ' + (index + 1)" placeholder="Secret 名称" :disabled="disabled" @change="update(index, 'secretName', $event)" /></label>
        <label><span>键 <em>*</em></span><t-input :value="reference.key" :name="kind + 'Key'" :aria-label="kind + ' 键 ' + (index + 1)" placeholder="Secret 中的键" :disabled="disabled" @change="update(index, 'key', $event)" /></label>
      </div>
    </div>
    <p v-if="error" class="build-references__error">{{ error }}</p>
    <span v-if="disabled && !modelValue.length" class="build-references__empty">未设置{{ kind === 'ssh' ? ' SSH 密钥引用' : '构建 Secrets' }}</span>
    <t-button v-if="!disabled" variant="text" theme="primary" @click="add"><template #icon><t-icon name="add" /></template>{{ kind === 'ssh' ? '添加 SSH 引用' : '添加 Secret 引用' }}</t-button>
  </section>
</template>

<style scoped>
.build-references h3{margin:0;font-size:13px;font-weight:600}.build-references>p{margin:4px 0 12px;color:#596168;font-size:13px;line-height:20px}.build-reference{border:1px solid #d0d4d9;border-radius:4px;margin-bottom:12px;padding:0 12px 12px}.build-reference__head{display:flex;justify-content:space-between;align-items:center;min-height:36px;margin-bottom:8px;font-size:12px}.build-reference__head strong{font-weight:500}.build-reference__fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.build-reference__fields label{display:flex;min-width:0;flex-direction:column;gap:8px;font-size:12px}.build-reference__fields em{font-style:normal;color:#d54941}.build-references .build-references__error{color:#d54941;font-size:12px;margin:6px 0}.build-references__empty{color:#767d84;font-size:13px}
</style>
