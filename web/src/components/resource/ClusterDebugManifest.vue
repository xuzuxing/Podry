<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import type { K8sResource } from '@/types'
import { resourceManifestDiff, resourceManifestView } from '@/utils/resourceManifest'
import { validateDebugManifest } from '@/utils/clusterTerminal'
import ResourceYamlEditor from './ResourceYamlEditor.vue'
import ResourceYamlDiffEditor from './ResourceYamlDiffEditor.vue'
import ResourceDiffNavigation from './ResourceDiffNavigation.vue'
import type { ManifestDiffPosition } from '@/utils/resourceYamlMerge'

const props = defineProps<{ resource: K8sResource; apply: (text: string) => Promise<boolean> }>()
const mode = ref<'read' | 'edit' | 'review'>('read'), hideManaged = ref(true), draft = ref(''), baseline = ref(''), error = ref(''), saving = ref(false)
const discard = ref(false), recreate = ref(false), position = ref<ManifestDiffPosition>({ total: 0, current: 0 })
const diffEditor = useTemplateRef<InstanceType<typeof ResourceYamlDiffEditor>>('diffEditor')
const singleEditor = useTemplateRef<InstanceType<typeof ResourceYamlEditor>>('singleEditor')
const view = computed(() => resourceManifestView(props.resource.manifest, hideManaged.value))
const text = computed({ get: () => view.value.text, set: () => {} })
const dirty = computed(() => mode.value !== 'read' && draft.value !== baseline.value)
const diff = computed(() => resourceManifestDiff(baseline.value, draft.value))
let pending: ((leave: boolean) => void) | undefined
function cancel() { mode.value = 'read'; error.value = ''; recreate.value = false }
function requestLeave(): boolean | Promise<boolean> {
  if (saving.value || pending) return false
  if (!dirty.value) { cancel(); return true }
  discard.value = true
  return new Promise(resolve => { pending = resolve })
}
function resolveLeave(value: boolean) { discard.value = false; if (value) cancel(); const resolve = pending; pending = undefined; resolve?.(value) }
function edit() { baseline.value = view.value.text; draft.value = baseline.value; error.value = ''; mode.value = 'edit' }
function review() { error.value = validateDebugManifest(draft.value, props.resource); if (!error.value) mode.value = 'review' }
async function apply() {
  error.value = validateDebugManifest(draft.value, props.resource)
  if (error.value) { recreate.value = false; return }
  saving.value = true; recreate.value = false
  try { if (await props.apply(draft.value)) { cancel(); void MessagePlugin.success('本地调试 Pod 已重新创建') } else error.value = '调试 Pod 重建失败，草稿已保留，请重试' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '重建失败' }
  finally { saving.value = false }
}
async function copy() { try { await navigator.clipboard.writeText(mode.value === 'read' ? view.value.text : draft.value); void MessagePlugin.success('Manifest 已复制') } catch { void MessagePlugin.error('复制失败，请手动选择文本') } }
function unload(event: BeforeUnloadEvent) { if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = '' } }
onBeforeRouteLeave(() => requestLeave())
onBeforeRouteUpdate(() => requestLeave())
onMounted(() => window.addEventListener('beforeunload', unload))
onBeforeUnmount(() => { window.removeEventListener('beforeunload', unload); pending?.(false) })
defineExpose({ requestLeave })
</script>

<template>
  <section class="debug-manifest" :data-mode="mode">
    <header class="debug-manifest__tools">
      <span>{{ resource.ref.name }}</span>
      <t-checkbox v-if="mode === 'read'" v-model="hideManaged">隐藏托管字段</t-checkbox>
      <t-button v-if="mode === 'read'" size="small" variant="text" @click="edit">编辑</t-button>
      <template v-else>
        <t-button v-if="mode === 'edit'" size="small" variant="text" @click="review">预览修改</t-button>
        <template v-else><t-button size="small" theme="primary" :loading="saving" @click="recreate = true">应用修改</t-button><t-button size="small" variant="text" :disabled="saving" @click="mode = 'edit'">返回编辑</t-button></template>
        <t-button size="small" variant="text" :disabled="saving" @click="requestLeave">取消</t-button>
      </template>
      <t-button v-if="mode !== 'review'" size="small" variant="text" aria-label="查找调试 Pod Manifest" :disabled="saving" @click="singleEditor?.search()"><t-icon name="search" /></t-button>
      <t-button size="small" variant="text" aria-label="复制调试 Pod Manifest" :disabled="saving" @click="copy"><t-icon name="file-copy" /></t-button>
    </header>
    <p v-if="error" class="debug-manifest__error" role="alert">{{ error }}</p>
    <div v-if="mode === 'review'" class="debug-manifest__titles"><span>当前 Pod Manifest · −{{ diff.removed }}</span><span>修改后的 Manifest · +{{ diff.added }}<ResourceDiffNavigation v-bind="position" @navigate="diffEditor?.navigate($event)" /></span></div>
    <div v-if="mode === 'review'" class="debug-manifest__editors debug-manifest__editors--review"><ResourceYamlDiffEditor ref="diffEditor" :original="baseline" :modified="draft" readonly original-label="当前调试 Pod Manifest" modified-label="修改后的调试 Pod Manifest" @position="position = $event" /></div>
    <div v-else class="debug-manifest__editors"><ResourceYamlEditor v-if="mode === 'read'" ref="singleEditor" v-model="text" readonly label="调试 Pod Manifest" /><ResourceYamlEditor v-else ref="singleEditor" v-model="draft" :readonly="saving" autofocus label="编辑调试 Pod Manifest" /></div>
    <t-dialog :visible="discard" :z-index="3600" header="放弃调试 Pod 的修改？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="resolveLeave(true)" @close="resolveLeave(false)">未保存的 Manifest 草稿将被丢弃。</t-dialog>
    <t-dialog :visible="recreate" :z-index="3600" header="重新创建调试 Pod？" confirm-btn="重新创建" cancel-btn="继续检查" :close-on-overlay-click="false" @confirm="apply" @close="recreate = false">应用修改将重新创建 {{ resource.ref.name }} 并重连终端。当前操作只修改本地 Mock。</t-dialog>
  </section>
</template>

<style scoped>
.debug-manifest{display:flex;flex:1;flex-direction:column;min-height:0;background:#1e1e1e}.debug-manifest__tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:38px;padding:0 16px;background:#fff;color:var(--tk-text-2);border-bottom:1px solid var(--tk-border);font-size:12px}.debug-manifest__tools>span{margin-right:auto;overflow-wrap:anywhere}.debug-manifest__tools :deep(.t-button){font-size:12px}.debug-manifest__editors{height:calc(100dvh - 270px);min-height:300px;flex:1}.debug-manifest__titles{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.debug-manifest__titles>span{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:12px;background:#252526;color:#ddd}.debug-manifest__error{margin:0;padding:8px 16px;background:#fff0ee;color:#d54941;font-size:12px;white-space:pre-wrap}
</style>
