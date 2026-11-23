<script setup lang="ts">
import { computed, nextTick, onScopeDispose, shallowRef, useTemplateRef, watch } from 'vue'
import type { K8sResource } from '@/types'
import { usePodTerminal } from '@/composables/usePodTerminal'
import { POD_SHELLS, terminalPrompt } from '@/utils/podTerminal'
import TerminalViewport from './TerminalViewport.vue'

const props = defineProps<{ resource: K8sResource; clusterId: string; active: boolean; initialContainer?: string; context?: Record<string, string> }>()
const emit = defineEmits<{ container: [name: string] }>()
const { containers, container, shell, lines, input, session, status, error, online, unavailable, connected, connect, disconnect, clear, submit, recall, interrupt } = usePodTerminal({ resource: () => props.resource, clusterId: () => props.clusterId, active: () => props.active, initialContainer: () => props.initialContainer })
watch([() => props.active, container], ([active, name]) => { if (active && name) emit('container', name) }, { immediate: true })
const fullscreen = shallowRef(false)
const copyMessage = shallowRef('')
const viewport = useTemplateRef<InstanceType<typeof TerminalViewport>>('viewport')
const root = useTemplateRef<HTMLElement>('root'), expandButton = useTemplateRef<HTMLButtonElement>('expandButton')
const groups = computed(() => (['containers', 'initContainers', 'ephemeralContainers'] as const).map(type => ({ type, label: { containers: '主容器', initContainers: '初始化容器', ephemeralContainers: '临时容器' }[type], items: containers.value.filter(item => item.type === type).sort((a, b) => a.name.localeCompare(b.name)) })).filter(group => group.items.length))
const metadata = computed(() => ({ ...(props.context ?? { 集群: props.clusterId, 命名空间: props.resource.ref.namespace }), Pod: props.resource.ref.name }))
const banner = computed(() => !online.value ? '当前处于离线状态，请检查网络连接' : error.value || unavailable.value || ({ idle: '等待连接', connecting: '正在连接…', connected: '', disconnected: '连接已断开。', error: '连接失败。', expired: '会话已过期。' }[status.value]))
function focus(): void { viewport.value?.focus() }
function clearScreen(): void { clear(); focus() }
function toggleFullscreen(): void { fullscreen.value = !fullscreen.value }
let copyTimer: ReturnType<typeof setTimeout> | undefined
let copyRequest = 0
async function copySelection(text: string): Promise<void> {
  if (!props.active || !text) return
  const request = ++copyRequest
  let message = '已复制'
  try { await navigator.clipboard.writeText(text) }
  catch { message = '复制失败，可按 Ctrl+C / ⌘C 手动复制' }
  if (request !== copyRequest || !props.active) return
  copyMessage.value = message
  clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyMessage.value = '' }, 2000)
}
function keydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); return }
  if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); fullscreen.value = false; return }
  if (fullscreen.value && event.key === 'Tab' && root.value) {
    const items = [...root.value.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item => item.checkVisibility())
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
let previousFocus: HTMLElement | null = null
watch(fullscreen, async (value) => {
  if (value) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  if (value) { if (connected.value) focus(); else expandButton.value?.focus() }
  else if (props.active && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = value ? previousFocus : null
})
watch(() => props.active, (active) => { if (!active) { fullscreen.value = false; ++copyRequest; copyMessage.value = '' } })
watch([() => props.resource.ref.uid, container, shell], () => { ++copyRequest; copyMessage.value = '' })
watch(connected, async (value) => { if (value) { await nextTick(); focus() } })
onScopeDispose(() => { previousFocus = null; ++copyRequest; clearTimeout(copyTimer) })
</script>

<template>
  <section ref="root" class="pod-terminal" :class="{ 'pod-terminal--fullscreen': fullscreen }" :role="fullscreen ? 'dialog' : 'region'" :aria-modal="fullscreen || undefined" aria-label="Pod 终端工作区" @keydown="keydown">
    <div v-if="fullscreen" class="pod-terminal__metadata"><strong>Podry</strong><span v-for="(value, key) in metadata" :key="key">{{ key }}: {{ value || '—' }}</span></div>
    <div class="pod-terminal__toolbar">
      <t-tooltip :content="status === 'connecting' || connected ? '断开终端' : '连接终端'"><t-button size="small" variant="text" :aria-label="status === 'connecting' || connected ? '断开终端' : '连接终端'" :disabled="!online || !containers.length" @click="status === 'connecting' || connected ? disconnect() : connect()"><t-icon :name="status === 'connecting' || connected ? 'link-unlink' : 'link'" /></t-button></t-tooltip>
      <t-tooltip content="清屏（Ctrl+L / ⌘K）"><t-button size="small" variant="text" aria-label="清空终端" @click="clearScreen"><t-icon name="clear" /></t-button></t-tooltip>
      <span class="pod-terminal__divider" /><label>容器</label>
      <t-select v-model="container" class="pod-terminal__container" size="small" :disabled="!containers.length" placeholder="无可用容器" aria-label="选择终端容器"><t-option-group v-for="group in groups" :key="group.type" :label="group.label"><t-option v-for="item in group.items" :key="item.name" :value="item.name" :label="item.name" /></t-option-group></t-select>
      <span class="pod-terminal__divider" /><label>Shell</label><t-select v-model="shell" class="pod-terminal__shell" size="small" :options="POD_SHELLS.map(value => ({ label: value, value }))" aria-label="选择终端 Shell" />
      <span class="pod-terminal__mock">Mock</span>
    </div>
    <div v-if="banner" class="pod-terminal__banner" :class="{ 'pod-terminal__banner--connecting': status === 'connecting' }" role="status"><span>{{ banner }}</span><button v-if="status !== 'connecting' && online && containers.length" type="button" @click="connect">{{ status === 'error' || status === 'expired' ? '重新连接' : '继续连接' }}</button></div>
    <div class="pod-terminal__screen">
      <TerminalViewport ref="viewport" v-model:input="input" class="pod-terminal__viewport" :lines="lines" :prompt="terminalPrompt(shell)" :connected="connected" :active="active" label="终端命令" :context-key="`${resource.ref.uid}/${container}/${shell}/${session?.sessionId ?? ''}`" @submit="submit" @recall="recall" @interrupt="interrupt" @disconnect="disconnect" @clear="clearScreen" @selected="copySelection" />
      <span v-if="copyMessage" class="pod-terminal__copy" role="status">{{ copyMessage }}</span>
      <button ref="expandButton" type="button" class="pod-terminal__expand" :aria-label="fullscreen ? '退出终端全屏' : '终端全屏'" :title="fullscreen ? '退出全屏（Esc）' : '全屏（Ctrl+Shift+F）'" @click="toggleFullscreen"><t-icon :name="fullscreen ? 'fullscreen-exit' : 'fullscreen'" /></button>
    </div>
    <div class="pod-terminal__footer"><span>{{ connected ? '已连接' : status === 'connecting' ? '连接中' : '未连接' }} · {{ container || '—' }} · {{ shell }}</span><span v-if="session" class="pod-terminal__session" :title="session.sessionId">会话 {{ session.sessionId }}</span><span>本地 Mock · 不执行真实命令</span></div>
  </section>
</template>

<style scoped>
.pod-terminal { display: flex; flex-direction: column; min-width: 0; background: #181920; color: #fff; }
.pod-terminal__toolbar { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 20px; color: var(--tk-text-2); background: #fff; border-bottom: 1px solid var(--tk-border); }
.pod-terminal__toolbar :deep(.t-button) { width: 24px; padding: 0; }
.pod-terminal__divider { width: 1px; height: 16px; background: var(--tk-border); }
.pod-terminal__container { width: 180px; }.pod-terminal__shell { width: 120px; }
.pod-terminal__toolbar :deep(.t-input) { border-color: transparent; box-shadow: none; }
.pod-terminal__mock { margin-left: auto; color: var(--tk-text-3); font-size: 11px; }
.pod-terminal__banner { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 3px 20px; background: #b02a37; font-size: 12px; }
.pod-terminal__banner--connecting { color: #473600; background: #ffecb3; }
.pod-terminal__banner button { padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
.pod-terminal__screen { position: relative; display: flex; flex: 1 1 auto; min-height: 420px; height: clamp(420px, calc(100vh - 300px), 720px); }
.pod-terminal__viewport { padding-right: 48px; }
.pod-terminal__expand { position: absolute; right: 12px; bottom: 12px; width: 28px; height: 28px; border: 1px solid #525667; border-radius: 4px; color: #fff; background: #292b37; cursor: pointer; }
.pod-terminal__expand:focus-visible { outline: 2px solid #70b6ff; outline-offset: 2px; }
.pod-terminal__copy { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); padding: 8px 16px; color: #000a14; background: #fff; border-radius: 8px; font-size: 12px; }
.pod-terminal__footer { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 5px 20px; border-top: 1px solid #343641; color: #a7acbc; font-size: 11px; }
.pod-terminal__footer > :last-child { margin-left: auto; }
.pod-terminal__session { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
.pod-terminal--fullscreen { position: fixed; inset: 0; z-index: 3000; }
.pod-terminal--fullscreen .pod-terminal__screen { height: auto; min-height: 0; }
.pod-terminal__metadata { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 28px; padding: 4px 12px; border-bottom: 1px solid #343641; color: #e5e7eb; font-size: 12px; }
.pod-terminal__metadata strong { color: #fff; }.pod-terminal__metadata span { padding-left: 12px; border-left: 1px solid #525667; overflow-wrap: anywhere; }
@media (max-width: 900px) { .pod-terminal__toolbar { flex-wrap: wrap; padding: 4px 12px; gap: 6px; }.pod-terminal__container { width: 150px; } }
</style>
