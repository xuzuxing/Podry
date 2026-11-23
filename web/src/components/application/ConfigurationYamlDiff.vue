<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue'
import ResourceYamlDiffEditor from '@/components/resource/ResourceYamlDiffEditor.vue'
import ResourceDiffNavigation from '@/components/resource/ResourceDiffNavigation.vue'
import type { ManifestDiffPosition } from '@/utils/resourceYamlMerge'

defineProps<{ left: string; right: string; leftLabel: string; rightLabel: string; changesOnly: boolean }>()
const editor = useTemplateRef<InstanceType<typeof ResourceYamlDiffEditor>>('editor')
const position = shallowRef<ManifestDiffPosition>({ total: 0, current: 0 })
</script>

<template>
  <section class="configuration-yaml-diff" aria-label="只读 YAML 配置对比">
    <header class="configuration-yaml-diff__labels">
      <div><strong :title="leftLabel">{{ leftLabel }}</strong><t-button size="small" variant="text" aria-label="查找基准配置" @click="editor?.search('original')"><t-icon name="search" /></t-button></div>
      <div><strong :title="rightLabel">{{ rightLabel }}</strong><t-button size="small" variant="text" aria-label="查找对比配置" @click="editor?.search('modified')"><t-icon name="search" /></t-button></div>
    </header>
    <ResourceYamlDiffEditor ref="editor" class="configuration-yaml-diff__document" :original="left" :modified="right" :original-label="leftLabel" :modified-label="rightLabel" :collapse-unchanged="changesOnly" readonly @position="position = $event" />
    <footer class="configuration-yaml-diff__footer"><span>只读 · YAML</span><ResourceDiffNavigation v-bind="position" @navigate="editor?.navigate($event)" /></footer>
  </section>
</template>

<style scoped>
.configuration-yaml-diff{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;background:#1e1e1e}.configuration-yaml-diff__labels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:none;background:#f4f7fa;color:#596168;font-size:12px}.configuration-yaml-diff__labels>div{display:flex;align-items:center;gap:8px;padding:4px 12px;min-width:0;border-right:1px solid #dce1e7}.configuration-yaml-diff__labels strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.configuration-yaml-diff__document{flex:1;min-height:0;height:auto}.configuration-yaml-diff__footer{display:flex;align-items:center;gap:12px;padding:3px 12px;flex:none;min-height:30px;background:#252526;color:#bbb;font-size:11px}
.configuration-yaml-diff:has(.resource-diff-minimap:not([hidden])) .configuration-yaml-diff__labels{padding-right:30px}
</style>
