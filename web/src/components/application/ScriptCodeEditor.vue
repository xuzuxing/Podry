<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { createScriptCodeEditor } from '@/utils/scriptCodeEditor'

const props = withDefaults(defineProps<{
  language: 'dockerfile' | 'shell'
  label: string
  context?: string
  readonly?: boolean
  loading?: boolean
  invalid?: boolean
}>(), { context: '', readonly: false, loading: false, invalid: false })
const model = defineModel<string>({ required: true })
const host = useTemplateRef<HTMLDivElement>('host')
const pending = shallowRef(true), error = shallowRef('')
let editor: ReturnType<typeof createScriptCodeEditor> | undefined, disposed = false, generation = 0

async function load() {
  const request = ++generation
  pending.value = true; error.value = ''
  editor?.destroy(); editor = undefined
  try {
    const { createScriptCodeEditor } = await import('@/utils/scriptCodeEditor')
    if (disposed || request !== generation || !host.value) return
    editor = createScriptCodeEditor(host.value, {
      text: model.value, language: props.language, label: props.label, context: props.context,
      readonly: props.readonly || props.loading, invalid: props.invalid, autofocus: false,
      change: text => { if (!props.readonly && !props.loading) model.value = text },
    })
  } catch (cause) {
    if (!disposed && request === generation) error.value = cause instanceof Error ? cause.message : '编辑器加载失败'
  } finally { if (!disposed && request === generation) pending.value = false }
}
watch([model, () => props.readonly, () => props.loading, () => props.label, () => props.context, () => props.invalid], () => {
  editor?.update(model.value, props.readonly || props.loading, props.label, props.context, props.invalid)
})
watch(() => props.language, load)
onMounted(load)
onBeforeUnmount(() => { disposed = true; ++generation; editor?.destroy() })
function handleKeydown(event: KeyboardEvent) {
  // Close native search before a surrounding TDesign drawer handles Escape.
  if (event.key === 'Escape' && editor?.closeSearch()) {
    event.preventDefault()
    event.stopPropagation()
  }
}
defineExpose({ search: () => editor?.search(), focus: () => editor?.focus() })
</script>

<template>
  <div class="script-code-editor" :class="{ 'script-code-editor--invalid': invalid }" :data-language="language" :data-state="pending ? 'loading' : error ? 'error' : 'ready'" :aria-busy="pending || loading" @keydown.capture="handleKeydown">
    <div ref="host" class="script-code-editor__host" />
    <div v-if="pending || loading || error" class="script-code-editor__state" :role="error ? 'alert' : 'status'">
      <template v-if="error"><span>{{ error }}</span><t-button size="small" variant="outline" @click="load">重新加载编辑器</t-button></template>
      <t-loading v-else loading :text="loading ? '读取模板…' : '正在加载编辑器…'" />
    </div>
  </div>
</template>

<style scoped>
.script-code-editor{position:relative;height:300px;min-width:0;overflow:hidden;background:#fff}.script-code-editor__host{height:100%;min-width:0}.script-code-editor--invalid{box-shadow:inset 0 0 0 1px var(--tk-danger)}.script-code-editor--invalid :deep(.cm-editor){outline:1px solid var(--tk-danger);outline-offset:-1px}.script-code-editor__state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;background:#fffffff0;overflow-wrap:anywhere}.script-code-editor :deep(.cm-editor){height:100%;overflow:hidden}.script-code-editor :deep(.cm-scroller){height:100%;overflow:auto}.script-code-editor :deep(.cm-search){font-size:11px;white-space:normal}.script-code-editor :deep(.cm-search label){display:inline-flex;align-items:center;gap:3px;margin-right:6px}.script-code-editor :deep(.cm-search button){cursor:pointer}
</style>
