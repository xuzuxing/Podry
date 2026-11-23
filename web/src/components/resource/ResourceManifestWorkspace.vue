<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import type { K8sResource } from '@/types'
import { useResourceManifest } from '@/composables/useResourceManifest'
import { resourceManifestDiff } from '@/utils/resourceManifest'
import ResourceYamlEditor from './ResourceYamlEditor.vue'
import ResourceManifestComparison from './ResourceManifestComparison.vue'
import ResourceYamlDiffEditor from './ResourceYamlDiffEditor.vue'
import ResourceDiffNavigation from './ResourceDiffNavigation.vue'
import type { ManifestDiffPosition } from '@/utils/resourceYamlMerge'

const props = defineProps<{ resource: K8sResource; clusterId: string; allowCompare?: boolean }>()
const emit = defineEmits<{ applied: [value: K8sResource] }>()
const { mode, hideManaged, draft, baseline, view, dirty, checking, saving, error, conflict, validated, canApply, busy, cancel, edit, review, apply, reload } = useResourceManifest({ resource: () => props.resource, clusterId: () => props.clusterId, applied: value => emit('applied', value) })
const visible = computed({ get: () => view.value.text, set: () => {} })
const diff = computed(() => mode.value === 'review' ? resourceManifestDiff(baseline.value, draft.value) : null)
const position = shallowRef<ManifestDiffPosition>({ total: 0, current: 0 })
const diffEditor = useTemplateRef<InstanceType<typeof ResourceYamlDiffEditor>>('diffEditor')
const singleEditor = useTemplateRef<InstanceType<typeof ResourceYamlEditor>>('singleEditor')
const discardVisible = shallowRef(false)
const comparing = shallowRef(false)
const compareTrigger = useTemplateRef<{ $el: HTMLButtonElement }>('compareTrigger')
let pending: ((value: boolean) => void) | undefined
function requestLeave(): boolean | Promise<boolean> {
  if (busy.value) return false
  if (!dirty.value) { cancel(); comparing.value = false; return true }
  if (pending) return false
  discardVisible.value = true
  return new Promise(resolve => { pending = resolve })
}
function resolveDiscard(value: boolean) {
  discardVisible.value = false
  if (value) cancel()
  const resolve = pending; pending = undefined; resolve?.(value)
}
async function requestCancel() { await requestLeave() }
async function requestReload() { if (await requestLeave()) await reload() }
async function compare() { if (props.allowCompare && await requestLeave()) comparing.value = true }
async function closeCompare() { comparing.value = false; await nextTick(); compareTrigger.value?.$el.focus({ preventScroll: true }) }
async function copy() {
  try { await navigator.clipboard.writeText(mode.value === 'read' ? view.value.text : draft.value); MessagePlugin.success('Manifest 已复制') }
  catch { MessagePlugin.error('复制失败，请手动选择文本') }
}
function download() {
  const url = URL.createObjectURL(new Blob([mode.value === 'read' ? view.value.text : draft.value], { type: 'application/yaml;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url
  anchor.download = `${props.resource.kind.toLowerCase()}-${props.resource.ref.name}.yaml`; anchor.click(); URL.revokeObjectURL(url)
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
onBeforeRouteLeave(() => requestLeave())
onBeforeRouteUpdate((to, from) => to.fullPath === from.fullPath ? true : requestLeave())
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); pending?.(false) })
defineExpose({ requestLeave })
</script>

<template>
  <section class="resource-manifest" :data-mode="mode" :data-comparing="comparing">
    <header class="resource-manifest__toolbar">
      <slot name="tabs" />
      <div v-if="!comparing" class="resource-manifest__actions">
        <t-checkbox v-if="mode === 'read' && view.hasManagedFields" v-model="hideManaged">隐藏托管字段</t-checkbox>
        <t-button v-if="mode === 'read'" size="small" variant="text" @click="edit"><template #icon><t-icon name="edit" /></template>编辑实时 Manifest</t-button>
        <template v-else>
          <t-button v-if="mode === 'edit' || validated !== draft" size="small" variant="text" :loading="checking" :disabled="busy" @click="review">{{ mode === 'review' ? '重新校验' : '预览并保存修改' }}</t-button>
          <t-button v-if="mode === 'review'" size="small" variant="text" :loading="saving" :disabled="!canApply" @click="apply">应用修改</t-button>
          <t-button v-if="mode === 'review'" size="small" variant="text" :disabled="busy" @click="mode = 'edit'">返回编辑</t-button>
          <t-button size="small" variant="text" :disabled="busy" @click="requestCancel">取消</t-button>
        </template>
        <t-button v-if="mode === 'read' && allowCompare" ref="compareTrigger" class="resource-manifest__compare" size="small" variant="text" @click="compare"><template #icon><t-icon name="swap" /></template>与期望 Manifest 比较</t-button>
      </div>
      <slot name="actions" :busy="busy" />
    </header>
    <ResourceManifestComparison v-if="comparing" :resource="resource" :cluster-id="clusterId" @close="closeCompare" />
    <template v-else>
    <div v-if="error" class="resource-manifest__error" role="alert"><t-icon name="error-circle" /><span>{{ error }}</span><t-button v-if="conflict" size="small" variant="text" :disabled="busy" @click="requestReload">重新读取</t-button></div>
    <p v-if="view.error && mode === 'read'" class="resource-manifest__notice">当前 Manifest 无法解析，显示原文：{{ view.error }}</p>
    <div v-if="mode === 'review'" class="resource-manifest__review-head"><span>当前实时 Manifest <small>−{{ diff?.removed }}</small><t-button size="small" variant="text" aria-label="查找当前实时 Manifest" @click="diffEditor?.search('original')"><t-icon name="search" /></t-button></span><span>修改后的 Manifest <small>+{{ diff?.added }}</small><em>{{ validated === draft ? '本地字段检查通过' : '内容已修改，请重新校验' }}</em><t-button size="small" variant="text" aria-label="查找修改后的 Manifest" @click="diffEditor?.search('modified')"><t-icon name="search" /></t-button><ResourceDiffNavigation v-bind="position" @navigate="diffEditor?.navigate($event)" /></span></div>
    <div v-if="mode === 'review'" class="resource-manifest__review">
      <ResourceYamlDiffEditor ref="diffEditor" v-model:modified="draft" :original="baseline" :readonly="busy" original-label="当前实时 Manifest" modified-label="修改后的 Manifest" @position="position = $event" />
    </div>
    <div v-else class="resource-manifest__editor"><ResourceYamlEditor v-if="mode === 'read'" ref="singleEditor" v-model="visible" readonly label="实时 Manifest" /><ResourceYamlEditor v-else ref="singleEditor" v-model="draft" :readonly="busy" autofocus label="编辑实时 Manifest" /></div>
    <footer class="resource-manifest__footer"><span>{{ resource.kind }} / {{ resource.ref.name }}</span><span v-if="dirty">有未保存的修改</span><span v-if="checking">正在进行本地字段检查…</span><div class="resource-manifest__exports" aria-label="Manifest 导出">
      <t-button v-if="mode !== 'review'" size="small" variant="text" aria-label="查找 Manifest" :disabled="busy" @click="singleEditor?.search()"><template #icon><t-icon name="search" /></template></t-button>
      <t-button size="small" variant="text" aria-label="复制 Manifest" :disabled="busy" @click="copy"><template #icon><t-icon name="file-copy" /></template></t-button>
      <t-button size="small" variant="text" aria-label="下载 Manifest" :disabled="busy" @click="download"><template #icon><t-icon name="download" /></template></t-button>
    </div></footer>
    </template>
    <t-dialog :visible="discardVisible" header="放弃未保存的 Manifest 修改？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="resolveDiscard(true)" @close="resolveDiscard(false)"><p>离开后，当前资源的 Manifest 草稿将被丢弃。</p></t-dialog>
  </section>
</template>

<style scoped>
.resource-manifest{display:flex;min-width:0;flex-direction:column;background:#1e1e1e}.resource-manifest__toolbar{display:flex;align-items:center;gap:12px;height:32px;box-sizing:border-box;padding:0 20px;overflow-x:auto;overflow-y:hidden;background:#fff;border-bottom:1px solid #d0d4d9}.resource-manifest__actions{display:flex;align-items:center;gap:4px;flex:none;min-height:32px;white-space:nowrap}.resource-manifest__toolbar:has(.resource-detail-tabs) .resource-manifest__actions{padding-left:12px;border-left:1px solid #d0d4d9}.resource-manifest__actions :deep(.t-button){height:28px;font-size:12px;padding:0 5px}.resource-manifest__actions :deep(.resource-manifest__compare){border-left:1px solid #d0d4d9;border-radius:0;padding-left:12px;margin-left:8px}.resource-manifest__actions :deep(.t-checkbox){font-size:12px;margin-right:8px}.resource-manifest__editor{height:clamp(360px,calc(100dvh - 270px),800px);min-width:0}.resource-manifest__review{height:clamp(360px,calc(100dvh - 308px),800px);min-width:0}.resource-manifest__review-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);font-size:12px;background:#252526;color:#ddd;border-bottom:1px solid #444}.resource-manifest__review-head>span{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 12px}.resource-manifest__review-head small{color:#ffb0b0}.resource-manifest__review-head>span+span small{color:#8dd9a0}.resource-manifest__review-head :deep(.t-button){height:24px;width:24px;padding:0;color:#bbb}.resource-manifest__review-head em{margin-left:auto;font-size:11px;color:#aaa;font-style:normal}.resource-manifest__footer{display:flex;align-items:center;gap:12px;min-height:28px;padding:0 12px;font-size:11px;color:#aaa;background:#252526;border-top:1px solid #444}.resource-manifest__exports{display:flex;gap:2px;margin-left:auto}.resource-manifest__exports :deep(.t-button){width:26px;height:26px;padding:0;color:#bbb}.resource-manifest__exports :deep(.t-button:hover){color:#fff;background:#444}.resource-manifest__error{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;color:#d54941;background:#fff0ee}.resource-manifest__error>span{min-width:0;flex:1}.resource-manifest__notice{padding:8px 12px;font-size:12px;color:#e9c780;background:#332e20;margin:0}
.resource-manifest:has(.resource-diff-minimap:not([hidden])) .resource-manifest__review-head{padding-right:30px}
</style>
