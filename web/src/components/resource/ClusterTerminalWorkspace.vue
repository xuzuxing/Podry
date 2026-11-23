<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, useTemplateRef, watch } from 'vue'
import { parseDocument } from 'yaml'
import type { Cluster, K8sResource, NodeTaint } from '@/types'
import { useClusterTerminal } from '@/composables/useClusterTerminal'
import { AUTO_NODE, CLUSTER_SHELLS, CLUSTER_TERMINAL_IMAGES } from '@/utils/clusterTerminal'
import type { ClusterTerminalSelection } from '@/utils/clusterTerminal'
import ClusterDebugEvents from './ClusterDebugEvents.vue'
import ClusterDebugManifest from './ClusterDebugManifest.vue'
import TerminalViewport from './TerminalViewport.vue'

const props = defineProps<{ cluster: Cluster; nodes: K8sResource[]; namespaces: string[]; selection: ClusterTerminalSelection }>()
const emit = defineEmits<{ select: [selection: Partial<ClusterTerminalSelection>] }>()
const debug = ref(false), tab = ref<'terminal' | 'events' | 'manifest'>('terminal'), fullscreen = ref(false), copyMessage = ref('')
const root = useTemplateRef<HTMLElement>('root'), viewport = useTemplateRef<InstanceType<typeof TerminalViewport>>('viewport'), expand = useTemplateRef<HTMLButtonElement>('expand')
const manifest = useTemplateRef<InstanceType<typeof ClusterDebugManifest>>('manifest')
const terminal = useClusterTerminal({ clusterId: () => props.cluster.id, clusterName: () => props.cluster.name, selection: () => props.selection, nodes: () => props.nodes.map(node => node.ref.name), debug: () => debug.value, taints: () => {
  const node = props.nodes.find(item => item.ref.name === (props.selection.node === AUTO_NODE ? props.nodes[0]?.ref.name : props.selection.node))
  if (!node) return []
  try { const taints = parseDocument(node.manifest).toJS({ maxAliasCount: 100 }).spec?.taints; return Array.isArray(taints) ? taints as NodeTaint[] : [] } catch { return [] }
} })
const { session, pod, events, status, error, online, lines, input, connected, prompt, selectedNode, busy, connect, disconnect, clear, recall, interrupt, submit, applyManifest } = terminal
const nodeGroups = computed(() => [
  { label: 'Worker nodes', nodes: props.nodes.filter(node => !/control-plane|master/.test(node.manifest)) },
  { label: 'Control plane', nodes: props.nodes.filter(node => /control-plane|master/.test(node.manifest)) },
].filter(group => group.nodes.length))
const namespaceOptions = computed(() => [...new Set([...props.namespaces, props.selection.namespace])].map(value => ({ label: value, value })))
const imageOptions = computed(() => CLUSTER_TERMINAL_IMAGES.some(item => item.value === props.selection.image) ? CLUSTER_TERMINAL_IMAGES : [...CLUSTER_TERMINAL_IMAGES, { label: props.selection.image, value: props.selection.image }])
const banner = computed(() => !online.value ? '网络已离线，请检查网络连接' : error.value || (status.value === 'connecting' ? '正在创建调试 Pod 并连接…' : status.value === 'expired' ? '会话已过期。' : !connected.value ? '连接已断开。' : ''))
async function select(key: keyof ClusterTerminalSelection, value: string | number | boolean) { emit('select', { [key]: String(value) }) }
async function switchTab(next: typeof tab.value) { if (next === tab.value || await manifest.value?.requestLeave() === false) return; tab.value = next }
async function toggleDebug() { if (await manifest.value?.requestLeave() === false) return; debug.value = !debug.value }
async function reconnect() { if (await manifest.value?.requestLeave() === false) return; await connect() }
function focus() { viewport.value?.focus() }
function clearScreen() { clear(); focus() }
let previousFocus: HTMLElement | null = null, copyTimer: ReturnType<typeof setTimeout> | undefined, copyGeneration = 0
async function copySelection(text: string) {
  if (tab.value !== 'terminal' || !text) return
  const request = ++copyGeneration
  let message = '已复制'
  try { await navigator.clipboard.writeText(text) } catch { message = '复制失败，可按 Ctrl+C / ⌘C 手动复制' }
  if (request !== copyGeneration) return
  copyMessage.value = message; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyMessage.value = '' }, 2000)
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen.value = !fullscreen.value; return }
  if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); fullscreen.value = false; return }
  if (fullscreen.value && event.key === 'Tab' && root.value) {
    const items = [...root.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,[tabindex="0"]')].filter(item => item.checkVisibility()), first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
watch(fullscreen, async value => {
  if (value) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  if (value) { if (connected.value && tab.value === 'terminal') focus(); else expand.value?.focus() }
  else { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); previousFocus = null }
})
watch(() => props.selection.node, value => { if (value === AUTO_NODE) debug.value = false }, { flush: 'sync' })
watch([connected, tab], async () => { await nextTick(); focus() })
watch(() => props.selection, () => { ++copyGeneration; copyMessage.value = '' })
onScopeDispose(() => { ++copyGeneration; clearTimeout(copyTimer) })
</script>

<template>
  <section ref="root" class="cluster-terminal" :class="{ 'cluster-terminal--fullscreen': fullscreen }" :role="fullscreen ? 'dialog' : 'region'" :aria-modal="fullscreen || undefined" aria-label="集群终端工作区" @keydown="keydown">
    <div v-if="fullscreen" class="cluster-terminal__metadata"><strong>Podry</strong><span>Node: {{ selectedNode }}</span><span>Namespace: {{ selection.namespace }}</span></div>
    <div class="cluster-terminal__selectors">
      <label>节点</label><t-select :value="selection.node" size="small" class="cluster-terminal__node" aria-label="选择终端节点" filterable @change="select('node', $event)"><t-option :value="AUTO_NODE" label="自动选择" /><t-option-group v-for="group in nodeGroups" :key="group.label" :label="group.label"><t-option v-for="item in group.nodes" :key="item.ref.uid" :value="item.ref.name" :label="item.ref.name" /></t-option-group></t-select>
      <span class="cluster-terminal__divider" /><label>命名空间</label><t-select :value="selection.namespace" class="cluster-terminal__namespace" size="small" aria-label="选择终端命名空间" filterable creatable :options="namespaceOptions" @change="select('namespace', $event)" @create="select('namespace', $event)" />
      <span class="cluster-terminal__divider" /><label>镜像</label><t-select :value="selection.image" class="cluster-terminal__image" size="small" aria-label="选择终端镜像" filterable creatable :options="imageOptions" @change="select('image', $event)" @create="select('image', $event)" />
      <t-tooltip content="选择包含 kubectl、helm、curl 等工具的镜像，也可以输入公开镜像路径。本地目录仅提供示例；Mock 不会拉取镜像。"><t-icon name="help-circle" /></t-tooltip>
      <button ref="expand" type="button" class="cluster-terminal__expand" :aria-label="fullscreen ? '退出集群终端全屏' : '集群终端全屏'" title="Ctrl+Shift+F / Esc" @click="fullscreen = !fullscreen"><t-icon :name="fullscreen ? 'fullscreen-exit' : 'fullscreen'" /></button>
    </div>
    <div class="cluster-terminal__toolbar">
      <div class="cluster-terminal__tabs" role="tablist" aria-label="调试 Pod 工作区"><button v-for="item in [{ key: 'terminal', label: '终端' }, ...(pod ? [{ key: 'events', label: 'Pod 事件' }, { key: 'manifest', label: 'Pod Manifest' }] : [])]" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" :class="{ active: tab === item.key }" @click="switchTab(item.key as typeof tab)">{{ item.label }}</button></div>
      <template v-if="tab === 'terminal'">
        <span class="cluster-terminal__divider" /><t-button size="small" variant="text" :disabled="!online" :aria-label="connected || status === 'connecting' ? '断开集群终端' : '连接集群终端'" @click="connected || status === 'connecting' ? disconnect() : connect()"><t-icon :name="connected || status === 'connecting' ? 'link-unlink' : 'link'" /></t-button>
        <t-button size="small" variant="text" aria-label="清空集群终端" @click="clearScreen"><t-icon name="clear" /></t-button>
        <span class="cluster-terminal__divider" /><label>Shell</label><t-select :value="selection.shell" class="cluster-terminal__shell" size="small" :options="CLUSTER_SHELLS.map(value => ({ label: value, value }))" aria-label="选择集群终端 Shell" @change="select('shell', $event)" />
        <template v-if="selection.node !== AUTO_NODE"><span class="cluster-terminal__divider" /><t-tooltip content="在所选节点上创建调试 Pod，打开节点交互终端。Mock 仅展示此工作流，不会访问主机。"><label class="cluster-terminal__debug">Debug Mode<t-switch :value="debug" size="small" aria-label="节点 Debug Mode" @change="toggleDebug" /><t-icon name="help-circle" /></label></t-tooltip></template>
      </template>
      <span class="cluster-terminal__mock">Mock</span>
    </div>
    <div v-if="banner" class="cluster-terminal__banner" :class="{ 'cluster-terminal__banner--connecting': status === 'connecting' }" role="status"><span>{{ banner }}</span><button v-if="status !== 'connecting' && online" type="button" @click="reconnect">重新连接</button><button v-if="pod && status === 'error'" type="button" @click="switchTab('events')">查看 Pod 事件</button></div>
    <div v-show="tab === 'terminal'" class="cluster-terminal__screen">
      <TerminalViewport ref="viewport" v-model:input="input" class="cluster-terminal__viewport" :lines="lines" :prompt="prompt" :connected="connected" :busy="busy" :active="tab === 'terminal'" label="集群终端命令" :context-key="`${cluster.id}/${selection.node}/${selection.namespace}/${selection.image}/${selection.shell}/${session?.sessionId ?? ''}`" @submit="submit" @recall="recall" @interrupt="interrupt" @disconnect="disconnect" @clear="clearScreen" @selected="copySelection" /><span v-if="copyMessage" class="cluster-terminal__copy" role="status">{{ copyMessage }}</span>
    </div>
    <ClusterDebugEvents v-if="tab === 'events' && pod" :events="events" />
    <ClusterDebugManifest v-if="tab === 'manifest' && pod" ref="manifest" :resource="pod" :apply="applyManifest" />
    <footer class="cluster-terminal__footer"><span>{{ connected ? '已连接' : status === 'connecting' ? '连接中' : '未连接' }} · {{ selectedNode }} · {{ selection.namespace }}</span><span v-if="session" :title="session.sessionId">{{ session.sessionId }}</span><span>本地 Mock · 不执行真实命令</span></footer>
  </section>
</template>

<style scoped>
.cluster-terminal{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;background:#181920;color:#fff}.cluster-terminal__selectors,.cluster-terminal__toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:40px;padding:0 20px;background:#fff;color:var(--tk-text-2);border-bottom:1px solid var(--tk-border);font-size:12px}.cluster-terminal__selectors :deep(.t-input),.cluster-terminal__toolbar :deep(.t-input){border-color:transparent;box-shadow:none}.cluster-terminal__node{width:190px}.cluster-terminal__namespace{width:160px}.cluster-terminal__image{width:220px}.cluster-terminal__shell{width:90px}.cluster-terminal__divider{width:1px;height:16px;background:var(--tk-border)}.cluster-terminal__expand{margin-left:auto;display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--tk-text-2);cursor:pointer}.cluster-terminal__expand:focus-visible{outline:2px solid var(--tk-primary)}.cluster-terminal__tabs{display:flex;gap:20px;align-self:stretch}.cluster-terminal__tabs>button{padding:0;border:0;border-bottom:2px solid transparent;color:var(--tk-text-2);background:none;font:inherit;cursor:pointer}.cluster-terminal__tabs>button.active{color:var(--tk-primary);border-bottom-color:var(--tk-primary);font-weight:600}.cluster-terminal__debug{display:flex;align-items:center;gap:8px}.cluster-terminal__mock{margin-left:auto;color:var(--tk-text-3);font-size:11px}.cluster-terminal__toolbar :deep(.t-button){padding:0 4px}.cluster-terminal__banner{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:6px 20px;background:#b32d28;font-size:12px}.cluster-terminal__banner--connecting{background:#272a39;color:#bac3d3}.cluster-terminal__banner>button{border:0;padding:0;color:inherit;background:none;text-decoration:underline;font:inherit;cursor:pointer}.cluster-terminal__screen{position:relative;display:flex;flex:1;min-height:360px;height:calc(100dvh - 220px)}.cluster-terminal__copy{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);padding:8px 16px;background:#fff;color:#000a14;border-radius:8px;font-size:12px}.cluster-terminal__footer{display:flex;align-items:center;flex-wrap:wrap;gap:16px;padding:5px 20px;color:#a7acbc;border-top:1px solid #343641;font-size:11px}.cluster-terminal__footer>:last-child{margin-left:auto}.cluster-terminal--fullscreen{position:fixed;inset:0;z-index:3000}.cluster-terminal--fullscreen .cluster-terminal__screen{height:auto;min-height:0}.cluster-terminal__metadata{display:flex;align-items:center;flex-wrap:wrap;gap:16px;padding:8px 20px;font-size:12px;border-bottom:1px solid #343641}.cluster-terminal__metadata>span{padding-left:16px;border-left:1px solid #525667}@media(max-width:1200px){.cluster-terminal__selectors{padding:4px 12px;gap:6px}.cluster-terminal__node{width:160px}.cluster-terminal__namespace{width:135px}.cluster-terminal__image{width:180px}.cluster-terminal__toolbar{padding:0 12px}}
</style>
