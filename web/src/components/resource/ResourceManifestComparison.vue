<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { K8sResource } from '@/types'
import { useResourceManifestComparison } from '@/composables/useResourceManifestComparison'
import type { ManifestDiffPosition } from '@/utils/resourceYamlMerge'
import ResourceYamlDiffEditor from './ResourceYamlDiffEditor.vue'
import ResourceDiffNavigation from './ResourceDiffNavigation.vue'

const props = defineProps<{ resource: K8sResource; clusterId: string }>()
const emit = defineEmits<{ close: [] }>()
const { snapshot, loading, error, view, reload } = useResourceManifestComparison({ resource: () => props.resource, clusterId: () => props.clusterId })
const position = shallowRef<ManifestDiffPosition>({ total: 0, current: 0 })
const editor = useTemplateRef<InstanceType<typeof ResourceYamlDiffEditor>>('editor')
const closeButton = useTemplateRef<HTMLButtonElement>('closeButton')
onMounted(() => closeButton.value?.focus({ preventScroll: true }))
watch(view, () => { position.value = { total: 0, current: 0 } })
function keydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.key !== 'F7' || event.ctrlKey || event.metaKey || event.altKey) return
  event.preventDefault(); editor.value?.navigate(event.shiftKey ? -1 : 1)
}
async function copy(side: 'desired' | 'live'): Promise<void> {
  if (!view.value) return
  try { await navigator.clipboard.writeText(view.value[side]); MessagePlugin.success(`${side === 'desired' ? '期望' : '实时'} Manifest 已复制`) }
  catch { MessagePlugin.error('复制失败，请手动选择文本') }
}
function download(side: 'desired' | 'live'): void {
  if (!view.value) return
  const url = URL.createObjectURL(new Blob([view.value[side]], { type: 'application/yaml;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url
  anchor.download = `${props.resource.kind.toLowerCase()}-${props.resource.ref.name}-${side}.yaml`
  anchor.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="resource-compare" :data-state="loading ? 'loading' : error ? 'error' : !snapshot ? 'empty' : 'ready'" aria-label="期望与实时 Manifest 比较" @keydown="keydown">
    <header class="resource-compare__header">
      <div class="resource-compare__title"><span>期望 Manifest</span><button ref="closeButton" type="button" aria-label="关闭期望 Manifest" @click="emit('close')"><t-icon name="close" /></button></div>
      <div class="resource-compare__title"><span>实时 Manifest</span><ResourceDiffNavigation v-if="view" class="resource-compare__navigation" v-bind="position" @navigate="editor?.navigate($event)" /></div>
    </header>
    <div v-if="loading || error || !view" class="resource-compare__state" :role="error ? 'alert' : 'status'">
      <t-loading v-if="loading" loading text="正在读取期望 Manifest…" />
      <template v-else><t-icon :name="error ? 'error-circle' : 'file-unknown'" size="28px" /><strong>{{ error || '没有可用的期望 Manifest' }}</strong><p v-if="!error">当前资源没有演示期望快照。</p><t-button size="small" variant="outline" @click="reload">重新读取</t-button></template>
    </div>
    <div v-else class="resource-compare__panes">
      <ResourceYamlDiffEditor ref="editor" :original="view.desired" :modified="view.live" readonly original-label="期望 Manifest" modified-label="实时 Manifest 比较" @position="position = $event" />
    </div>
    <div v-if="view" class="resource-compare__exports"><div v-for="side in (['desired', 'live'] as const)" :key="side"><span>{{ side === 'desired' ? '演示期望快照' : '当前实时资源' }}</span><t-button size="small" variant="text" :aria-label="`查找${side === 'desired' ? '期望' : '实时'} Manifest`" @click="editor?.search(side === 'desired' ? 'original' : 'modified')"><t-icon name="search" /></t-button><t-button size="small" variant="text" :aria-label="`复制${side === 'desired' ? '期望' : '实时'} Manifest`" @click="copy(side)"><t-icon name="file-copy" /></t-button><t-button size="small" variant="text" :aria-label="`下载${side === 'desired' ? '期望' : '实时'} Manifest`" @click="download(side)"><t-icon name="download" /></t-button></div></div>
    <p class="resource-compare__note">本地 Mock 比较：忽略 status、服务端身份与托管字段，按键名整理配置；不会修改资源。</p>
  </section>
</template>

<style scoped>
.resource-compare{display:flex;min-width:0;flex-direction:column;color:#d4d4d4;background:#1e1e1e}.resource-compare__header,.resource-compare__exports{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);background:#252526;border-bottom:1px solid #444}.resource-compare__title{display:flex;align-items:center;gap:8px;min-width:0;min-height:32px;padding:0 12px;font-size:12px}.resource-compare__title:first-child{border-right:1px solid #555}.resource-compare__title>button{display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer}.resource-compare__title>button:hover{background:#444}.resource-compare__title>button:focus-visible{outline:1px solid #70b6ff}.resource-compare__navigation{display:flex;align-items:center;gap:4px;margin-left:auto;font-size:11px;color:#bbb}.resource-compare__navigation :deep(.t-button),.resource-compare__exports :deep(.t-button){width:24px;height:24px;padding:0;color:#bbb}.resource-compare__navigation :deep(.t-button:hover),.resource-compare__exports :deep(.t-button:hover){color:#fff;background:#444}.resource-compare__navigation :deep(.t-is-disabled){opacity:.35}.resource-compare__panes{height:clamp(360px,calc(100dvh - 308px),800px);min-width:0}.resource-compare__exports>div{display:flex;align-items:center;gap:4px;min-width:0;padding:2px 12px;font-size:11px;color:#aaa}.resource-compare__exports>div>span{flex:1}.resource-compare__state{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;min-height:360px;padding:20px;overflow-wrap:anywhere;white-space:pre-wrap;text-align:center}.resource-compare__state p{margin:0;color:#aaa;font-size:12px}.resource-compare__state :deep(.t-loading__text){color:#ccc}.resource-compare__note{margin:0;padding:6px 12px;color:#aaa;font-size:11px;background:#252526}
.resource-compare:has(.resource-diff-minimap:not([hidden])) .resource-compare__header,.resource-compare:has(.resource-diff-minimap:not([hidden])) .resource-compare__exports{padding-right:30px}
</style>
