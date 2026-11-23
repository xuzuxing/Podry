<script setup lang="ts">
import { useTemplateRef } from 'vue'
import ScriptCodeEditor from './ScriptCodeEditor.vue'

withDefaults(defineProps<{ readonly?: boolean; loading?: boolean; invalid?: boolean; context?: string }>(), { readonly: false, loading: false, invalid: false, context: '' })
const model = defineModel<string>({ required: true })
const editor = useTemplateRef<InstanceType<typeof ScriptCodeEditor>>('editor')
defineExpose({ search: () => editor.value?.search() })
</script>

<template>
  <ScriptCodeEditor ref="editor" v-model="model" class="dockerfile-editor" language="dockerfile" label="Dockerfile 内容" :context="context" :readonly="readonly" :loading="loading" :invalid="invalid" />
</template>

