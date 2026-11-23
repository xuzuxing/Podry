<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useResourceCreation } from '@/composables/useResourceCreation'
import ResourceYamlEditor from './ResourceYamlEditor.vue'
import ResourceCreationResults from './ResourceCreationResults.vue'

const props = defineProps<{ clusterId: string }>()
const emit = defineEmits<{ close: [refresh: boolean] }>()
const { manifest, phase, busy, canApply, error, rows, needsRefresh, apply, edit } = useResourceCreation({ clusterId: () => props.clusterId })
const editor = useTemplateRef<InstanceType<typeof ResourceYamlEditor>>('editor')
let closing = false
let initialFocusPending = true
function close(refresh = needsRefresh.value) { if (!busy.value && !closing) { closing = true; emit('close', refresh) } }
function focusAfterOpen(event: TransitionEvent) {
  if (!initialFocusPending || event.propertyName !== 'transform' || !(event.target instanceof HTMLElement) || !event.target.classList.contains('t-drawer__content-wrapper')) return
  initialFocusPending = false
  // A cached editor can mount while TDesign still hides the opening drawer.
  // Focus after the transition without interrupting a user already working inside it.
  if (phase.value === 'edit' && event.currentTarget instanceof HTMLElement && !event.currentTarget.contains(document.activeElement)) editor.value?.focus()
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
  event.preventDefault(); close()
}
function containShortcuts(event: KeyboardEvent) {
  // Keep application navigation/search shortcuts inside this modal workspace.
  // Default typing and native editor keybindings have already reached their target.
  if (event.key.toLowerCase() === 'k' || event.key === '/') event.stopPropagation()
}
function leave() { if (busy.value) return false; close(false); return true }
onBeforeRouteLeave(leave)
onBeforeRouteUpdate(leave)
onMounted(() => document.addEventListener('keydown', escape))
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
</script>

<template>
  <t-drawer visible header="创建 Kubernetes 资源" size="min(1024px, 100vw)" placement="right" drawer-class-name="resource-create-drawer" :footer="false" :close-btn="true" :close-on-overlay-click="false" :close-on-esc-keydown="false" @transitionend="focusAfterOpen" @keydown="containShortcuts" @close="close()">
    <section class="resource-create" :data-phase="phase" :aria-busy="busy">
      <template v-if="phase === 'edit'">
        <div class="resource-create__note"><t-icon name="info-circle" /><span>支持多文档 YAML：可一次创建或更新多个 K8s 资源，请用 <code>---</code> 分隔资源清单。</span></div>
        <p v-if="error" class="resource-create__error" role="alert"><t-icon name="error-circle" /><span>{{ error }}</span></p>
        <div class="resource-create__editor"><ResourceYamlEditor ref="editor" v-model="manifest" autofocus label="创建资源 YAML" /></div>
        <div class="resource-create__editor-tools"><span>YAML</span><t-button size="small" variant="text" aria-label="查找创建资源 YAML" @click="editor?.search()"><t-icon name="search" /></t-button></div>
      </template>
      <div v-else-if="busy" class="resource-create__loading" role="status"><t-loading loading /><h3>正在创建或更新资源</h3><p>请稍候，正在处理提交的资源清单。</p></div>
      <ResourceCreationResults v-else :rows="rows" />
      <footer class="resource-create__actions">
        <template v-if="phase !== 'result'"><t-button variant="outline" :disabled="busy" @click="close()">取消</t-button><t-button theme="primary" :loading="busy" :disabled="!canApply" @click="apply">应用</t-button></template>
        <template v-else><t-button class="resource-create__edit" variant="text" @click="edit"><template #icon><t-icon name="edit" /></template>编辑 YAML</t-button><t-button variant="outline" @click="close()">关闭</t-button></template>
      </footer>
    </section>
  </t-drawer>
</template>

<style>
.resource-create-drawer .t-drawer__body{padding:0;overflow:hidden;min-height:0}.resource-create-drawer .t-drawer__header{padding:16px 52px 16px 20px;border-bottom:1px solid var(--tk-border)}.resource-create-drawer .t-drawer__header h3{font-size:16px;font-weight:600}.resource-create-drawer .t-drawer__content-wrapper{display:flex;flex-direction:column;max-width:100vw}.resource-create-drawer .t-drawer__body{flex:1}
</style>
<style scoped>
.resource-create{display:flex;flex-direction:column;height:100%;min-height:0}.resource-create__note{display:flex;align-items:flex-start;gap:8px;padding:12px 20px;background:#f0f6ff;color:var(--tk-text-2);font-size:13px;line-height:20px}.resource-create__note :deep(.t-icon){flex:none;margin-top:2px;color:var(--tk-primary)}.resource-create__note code{font-family:var(--tk-mono)}.resource-create__editor{flex:1;min-height:0;overflow:hidden}.resource-create__editor-tools{display:flex;align-items:center;justify-content:space-between;height:28px;flex:none;padding:0 12px;background:#252526;color:#aaa;font-size:11px;border-top:1px solid #444}.resource-create__editor-tools :deep(.t-button){height:26px;width:26px;padding:0;color:#bbb}.resource-create__error{display:flex;align-items:flex-start;gap:8px;margin:0;padding:10px 20px;font-size:12px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0ee;color:#d54941}.resource-create__error :deep(.t-icon){flex:none;margin-top:2px}.resource-create__loading{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;min-height:0;padding:24px;color:var(--tk-text-2)}.resource-create__loading h3{font-size:16px;margin:20px 0 8px}.resource-create__loading p{font-size:13px;margin:0}.resource-create :deep(.resource-create-results){flex:1}.resource-create__actions{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:8px;padding:16px;border-top:1px solid var(--tk-border);background:var(--tk-surface)}.resource-create__edit{margin-right:auto}
</style>
