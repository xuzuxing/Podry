<script setup lang="ts">
import { useTemplateRef } from 'vue'
import ResourceYamlEditor from '@/components/resource/ResourceYamlEditor.vue'
import type { ResourceYamlSchema } from '@/utils/resourceYamlValidation'

withDefaults(defineProps<{ readonly?: boolean; label?: string; validatorSchema?: ResourceYamlSchema }>(), { readonly: false, label: '部署 Values YAML' })
const model = defineModel<string>({ required: true })
const editor = useTemplateRef<InstanceType<typeof ResourceYamlEditor>>('editor')
</script>

<template>
  <section class="values-editor" :class="{ 'values-editor--readonly': readonly }" :aria-label="label">
    <header class="values-editor__toolbar yaml-toolbar">
      <strong>{{ label }}</strong>
      <span class="values-editor__status"><slot name="status">{{ readonly ? '只读' : 'YAML' }}</slot></span>
      <t-button size="small" variant="text" aria-label="查找配置 YAML" title="查找（Ctrl+F）" @click="editor?.search()"><template #icon><t-icon name="search" /></template>查找</t-button>
      <slot name="actions" />
    </header>
    <ResourceYamlEditor ref="editor" v-model="model" :readonly="readonly" :label="label" :validator-schema="validatorSchema" class="values-editor__document" />
  </section>
</template>

<style scoped>
.values-editor{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;background:#1e1e1e;border:1px solid #dce1e7}.values-editor__toolbar{display:flex;align-items:center;gap:12px;flex:none;min-height:36px;padding:4px 12px;background:#f7f9fb;border-bottom:1px solid #dce1e7;color:#596168;font-size:12px}.values-editor__toolbar strong{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.values-editor__status{flex:1;font-size:11px}.values-editor__document{flex:1;min-height:0;height:auto}
</style>
