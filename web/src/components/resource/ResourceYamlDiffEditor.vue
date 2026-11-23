<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { createResourceYamlMerge, ManifestDiffPosition } from '@/utils/resourceYamlMerge'

const props = defineProps<{ original: string; modified: string; originalLabel: string; modifiedLabel: string; readonly?: boolean; collapseUnchanged?: boolean }>()
const emit = defineEmits<{ 'update:modified': [text: string]; position: [position: ManifestDiffPosition] }>()
const container = useTemplateRef<HTMLDivElement>('container')
const loading = shallowRef(true), error = shallowRef('')
let editor: ReturnType<typeof createResourceYamlMerge> | undefined, disposed = false, generation = 0
async function load() {
  const request = ++generation
  loading.value = true; error.value = ''
  try {
    const { createResourceYamlMerge } = await import('@/utils/resourceYamlMerge')
    if (disposed || request !== generation || !container.value) return
    editor = createResourceYamlMerge(container.value, { ...props, readonly: Boolean(props.readonly), change: text => emit('update:modified', text), position: value => emit('position', value) })
  } catch (cause) { if (!disposed && request === generation) error.value = cause instanceof Error ? cause.message : '差异编辑器加载失败' }
  finally { if (!disposed && request === generation) loading.value = false }
}
watch([() => props.original, () => props.modified, () => props.readonly, () => props.collapseUnchanged, () => props.originalLabel, () => props.modifiedLabel], () => editor?.update(props.original, props.modified, Boolean(props.readonly), Boolean(props.collapseUnchanged), props.originalLabel, props.modifiedLabel))
onMounted(load)
onBeforeUnmount(() => { disposed = true; ++generation; editor?.destroy() })
function navigate(direction: number) { editor?.navigate(direction) }
function search(side: 'original' | 'modified') { editor?.search(side) }
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== 'F7' || event.ctrlKey || event.metaKey || event.altKey) return
  event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1)
}
function closeSearch(event: KeyboardEvent) {
  if (event.key === 'Escape' && editor?.closeSearch(event.target)) {
    event.preventDefault(); event.stopPropagation()
  }
}
defineExpose({ navigate, search })
</script>

<template>
  <div class="resource-yaml-diff" :data-state="loading ? 'loading' : error ? 'error' : 'ready'" @keydown="keydown" @keydown.capture="closeSearch">
    <div ref="container" class="resource-yaml-diff__container" />
    <div v-if="loading || error" class="resource-yaml-diff__state" :role="error ? 'alert' : 'status'">
      <t-loading v-if="loading" loading text="正在加载差异编辑器…" />
      <template v-else><span>{{ error }}</span><t-button size="small" variant="outline" @click="load">重新加载编辑器</t-button></template>
    </div>
  </div>
</template>

<style scoped>
.resource-yaml-diff{position:relative;height:100%;min-width:0;overflow:hidden;background:#1e1e1e;color:#d4d4d4}.resource-yaml-diff__container{height:100%}.resource-yaml-diff__state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px;overflow-wrap:anywhere;background:#1e1e1e}.resource-yaml-diff__state :deep(.t-loading__text){color:#ccc}.resource-yaml-diff :deep(.cm-mergeView),.resource-yaml-diff :deep(.cm-mergeViewEditors){height:100%;min-width:0}.resource-yaml-diff :deep(.cm-mergeView .cm-editor){height:100%!important;overflow:hidden!important}.resource-yaml-diff :deep(.cm-mergeView .cm-editor .cm-scroller){height:100%!important;overflow-y:auto!important}.resource-yaml-diff :deep(.cm-mergeViewEditor){width:50%;min-width:0;overflow:hidden}.resource-yaml-diff :deep(.cm-mergeViewEditor:first-child){border-right:1px solid #555}.resource-yaml-diff :deep(.cm-merge-a .cm-changedLine){background:#4b292b}.resource-yaml-diff :deep(.cm-merge-b .cm-changedLine){background:#24462d}.resource-yaml-diff :deep(.cm-merge-a .cm-changedText){background:#943c43;text-decoration:none}.resource-yaml-diff :deep(.cm-merge-b .cm-changedText){background:#246e3b}.resource-yaml-diff :deep(.cm-changeGutter){width:3px}.resource-yaml-diff :deep(.cm-changedLineGutter){background:#be8844}.resource-yaml-diff :deep(.cm-mergeSpacer){background:repeating-linear-gradient(135deg,#ffffff04 0,#ffffff04 1px,transparent 1px,transparent 5px)}.resource-yaml-diff :deep(.cm-search){font-size:11px;white-space:normal}.resource-yaml-diff :deep(.cm-search label){display:inline-flex;align-items:center;gap:3px;margin-right:6px}.resource-yaml-diff :deep(.cm-search button){cursor:pointer}
</style>

<style scoped>
.resource-yaml-diff__container{display:flex;min-width:0}.resource-yaml-diff__container :deep(>.cm-mergeView){flex:1;min-width:0}.resource-yaml-diff :deep(.resource-diff-minimap){position:relative;flex:0 0 30px;width:30px;height:100%;overflow:hidden;touch-action:none;user-select:none;background:#1e1e1e;cursor:pointer;border-left:1px solid #444}.resource-yaml-diff :deep(.resource-diff-minimap[hidden]){display:none}.resource-yaml-diff :deep(.resource-diff-minimap:focus-visible){outline:1px solid #70b6ff;outline-offset:-1px}.resource-yaml-diff :deep(.resource-diff-minimap canvas){display:block;width:100%;height:100%;pointer-events:none}.resource-yaml-diff :deep(.resource-diff-minimap__viewport){position:absolute;top:0;left:0;width:100%;background:#aeb5bf33;border:1px solid #aeb5bf66;cursor:grab}.resource-yaml-diff :deep(.resource-diff-minimap--dragging),.resource-yaml-diff :deep(.resource-diff-minimap--dragging .resource-diff-minimap__viewport){cursor:grabbing}
</style>
