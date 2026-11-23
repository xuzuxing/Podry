<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import type { StageResourceReferences } from '@/types'
import type { StageResourceOption } from '@/utils/stageResources'
const props = defineProps<{ modelValue: StageResourceReferences; options: StageResourceOption[]; scope: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: StageResourceReferences] }>()
const open = shallowRef(false)
const search = shallowRef('')
const root = shallowRef<HTMLElement | null>(null)
function dismiss(event: PointerEvent): void {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown',dismiss))
onBeforeUnmount(() => document.removeEventListener('pointerdown',dismiss))
const filtered = computed(() => props.options.filter(item => item.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const selected = computed(() => (['configMaps','secrets'] as const).flatMap(kind => props.modelValue[kind].map(name => ({
  kind, name, missing: !props.options.some(item => item.kind === kind && item.name === name),
}))))
function toggle(kind: StageResourceOption['kind'], name: string): void {
  const values = props.modelValue[kind]
  emit('update:modelValue', { ...props.modelValue, [kind]: values.includes(name) ? values.filter(value => value !== name) : [...values,name] })
}
</script>
<template>
  <section ref="root" class="stage-resources" @keydown.esc.stop="open=false">
    <header v-if="!open"><strong>CONFIGMAPS &amp; SECRETS</strong><t-button variant="text" size="small" shape="square" aria-label="添加阶段配置引用" @click="open=true;search=''"><t-icon name="add" /></t-button></header>
    <div v-else class="stage-resource-search">
      <t-input v-model="search" size="small" aria-label="搜索阶段配置" placeholder="Search" autofocus clearable />
      <div class="stage-resource-options">
        <div v-for="item in filtered" :key="`${item.kind}:${item.name}`" class="stage-resource-option">
          <t-checkbox :checked="modelValue[item.kind].includes(item.name)" :aria-label="`${item.kind === 'configMaps' ? 'ConfigMap' : 'Secret'} ${item.name}`" @change="toggle(item.kind,item.name)"><span>{{ item.name }}</span></t-checkbox>
          <small>{{ item.kind === 'configMaps' ? 'ConfigMap' : 'Secret' }} · {{ item.inherited ? '继承基础配置' : '环境配置' }}</small>
        </div>
        <p v-if="!filtered.length">{{ options.length ? '没有匹配的配置' : '目标环境暂无可用配置' }}</p>
      </div>
    </div>
    <p class="stage-resource-scope">{{ scope }}</p>
    <div v-for="item in selected" :key="`${item.kind}:${item.name}`" class="stage-resource-selected" :class="{'is-missing':item.missing}">
      <t-icon :name="item.kind === 'secrets' ? 'lock-on' : 'file'" /><span :title="item.name">{{ item.name }}<small v-if="item.missing">已不可用，请移除引用</small></span><t-button variant="text" size="small" shape="square" :aria-label="`移除 ${item.kind === 'configMaps' ? 'ConfigMap' : 'Secret'} ${item.name}`" @click="toggle(item.kind,item.name)"><t-icon name="close" /></t-button>
    </div>
    <p v-if="!selected.length && !open" class="stage-resource-empty">尚未引用配置</p>
  </section>
</template>
<style scoped>
.stage-resources{border-top:1px solid var(--tk-border);padding-top:12px;font-size:12px}.stage-resources header{display:flex;justify-content:space-between;align-items:center;gap:6px}.stage-resources header strong{font-size:10px;letter-spacing:.02em}.stage-resources p{margin:6px 0;font-size:11px;line-height:16px;color:var(--tk-text-2)}.stage-resource-search{position:relative;margin:4px 0 8px}.stage-resource-options{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:2;max-height:260px;overflow:auto;padding:4px 8px;background:#fff;border:1px solid var(--tk-border);border-radius:4px;box-shadow:0 4px 10px #00000014;min-width:0}.stage-resource-option{padding:8px 0;border-bottom:1px solid var(--tk-border)}.stage-resource-option:last-child{border:0}.stage-resource-option :deep(.t-checkbox){display:flex;align-items:center;white-space:normal}.stage-resource-option :deep(.t-checkbox__label){overflow-wrap:anywhere;min-width:0;line-height:16px}.stage-resource-option small{display:block;padding-left:24px;margin-top:4px;font-size:10px;color:var(--tk-text-2)}.stage-resource-selected{display:flex;align-items:center;gap:6px;margin-top:8px;min-width:0}.stage-resource-selected>span{flex:1;min-width:0;overflow-wrap:anywhere;line-height:17px}.stage-resource-selected>.t-icon,.stage-resource-selected>.t-button{flex:none}.stage-resource-selected small{display:block;font-size:10px}.stage-resource-selected.is-missing{color:var(--tk-danger)}
</style>
