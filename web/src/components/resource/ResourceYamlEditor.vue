<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { createResourceYamlEditor } from '@/utils/resourceYamlEditor'
import type { ResourceYamlSchema } from '@/utils/resourceYamlValidation'

const props = withDefaults(defineProps<{ readonly?: boolean; label: string; autofocus?: boolean; validatorSchema?: ResourceYamlSchema }>(), { readonly: false, autofocus: false })
const model = defineModel<string>({ required: true })
const container = useTemplateRef<HTMLDivElement>('container')
const loading = shallowRef(true), error = shallowRef('')
let editor: ReturnType<typeof createResourceYamlEditor> | undefined, disposed = false, generation = 0
async function load() {
  const request = ++generation
  loading.value = true; error.value = ''
  try {
    const { createResourceYamlEditor } = await import('@/utils/resourceYamlEditor')
    if (disposed || request !== generation || !container.value) return
    editor = createResourceYamlEditor(container.value, { text: model.value, label: props.label, readonly: props.readonly, autofocus: props.autofocus, validatorSchema: props.validatorSchema, change: text => { model.value = text } })
  } catch (cause) { if (!disposed && request === generation) error.value = cause instanceof Error ? cause.message : '编辑器加载失败' }
  finally { if (!disposed && request === generation) loading.value = false }
}
watch([model, () => props.readonly, () => props.label, () => props.validatorSchema], () => editor?.update(model.value, props.readonly, props.label, props.validatorSchema))
onMounted(load)
onBeforeUnmount(() => { disposed = true; ++generation; editor?.destroy() })
function search() { editor?.search() }
function focus() { editor?.focus() }
function revealLine(line: number, focus = false) { editor?.revealLine(line, focus) }
function closeSearch(event: KeyboardEvent) {
  if (event.key === 'Escape' && editor?.closeSearch()) {
    event.preventDefault(); event.stopPropagation()
  }
}
defineExpose({ search, focus, revealLine })
</script>

<template>
  <div class="resource-yaml" :data-state="loading ? 'loading' : error ? 'error' : 'ready'" :aria-busy="loading" @keydown.capture="closeSearch">
    <div ref="container" class="resource-yaml__container" />
    <div v-if="loading || error" class="resource-yaml__state" :role="error ? 'alert' : 'status'">
      <t-loading v-if="loading" loading text="正在加载编辑器…" />
      <template v-else><span>{{ error }}</span><t-button size="small" variant="outline" @click="load">重新加载编辑器</t-button></template>
    </div>
  </div>
</template>

<style scoped>
.resource-yaml{position:relative;height:100%;min-width:0;overflow:hidden;background:#1e1e1e;color:#d4d4d4}.resource-yaml__container{height:100%;min-width:0}.resource-yaml__state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px;overflow-wrap:anywhere;background:#1e1e1e}.resource-yaml__state :deep(.t-loading__text){color:#ccc}.resource-yaml :deep(.cm-editor){height:100%;overflow:hidden}.resource-yaml :deep(.cm-scroller){height:100%;overflow:auto}.resource-yaml :deep(.cm-search){font-size:11px;white-space:normal}.resource-yaml :deep(.cm-search label){display:inline-flex;align-items:center;gap:3px;margin-right:6px}.resource-yaml :deep(.cm-search button){cursor:pointer}
</style>
