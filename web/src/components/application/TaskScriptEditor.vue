<script setup lang="ts">
import { useTemplateRef } from 'vue'
import ScriptCodeEditor from './ScriptCodeEditor.vue'

defineProps<{ context: string; invalid?: boolean }>()
const model = defineModel<string>({ required: true })
const editor = useTemplateRef<InstanceType<typeof ScriptCodeEditor>>('editor')
</script>

<template>
  <section class="task-script-editor">
    <header class="task-script-editor__toolbar"><span>Shell</span><t-button size="small" variant="text" aria-label="查找任务脚本" title="查找（Ctrl+F）" @click="editor?.search()"><template #icon><t-icon name="search" /></template>查找</t-button></header>
    <ScriptCodeEditor ref="editor" v-model="model" language="shell" label="任务脚本" :context="context" :invalid="invalid" />
  </section>
</template>

<style scoped>
.task-script-editor{min-width:0;overflow:hidden;border:1px solid var(--tk-border);border-radius:4px}.task-script-editor__toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;padding:2px 8px 2px 12px;color:#596168;background:#f7fafc;border-bottom:1px solid var(--tk-border);font-size:12px}.task-script-editor__toolbar :deep(.t-button){font-size:12px}
</style>
