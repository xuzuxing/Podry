<script setup lang="ts">
import { onScopeDispose, shallowRef, useTemplateRef, watch } from 'vue'
import { useXtermSurface } from '@/composables/useXtermSurface'
import { terminalCellWidth, terminalGraphemes } from '@/utils/terminalInput'

const props = defineProps<{ lines: string[]; wrap: boolean; follow: boolean; active: boolean; contextKey: string }>()
const emit = defineEmits<{ 'update:follow': [value: boolean] }>()
const host = useTemplateRef<HTMLElement>('host'), content = useTemplateRef<HTMLElement>('content')
const copyMessage = shallowRef('')
let snapshot: string[] = [], force = true, pending = false, disposed = false, revision = 0, writing = false, copied = 0
let timer: ReturnType<typeof setTimeout> | undefined
const surface = useXtermSurface(content, {
  label: () => '容器日志正文', interactive: false, active: () => props.active,
  resizeTarget: () => host.value,
  resize() { force = true; schedule() },
  ready(term) {
    term.onScroll(() => { if (!writing && props.follow && term.buffer.active.viewportY < term.buffer.active.baseY) emit('update:follow', false) })
    term.attachCustomKeyEventHandler(event => {
      if (event.type === 'keydown' && event.key === 'Enter') { term.writeln(''); return false }
      return true
    })
    schedule()
  },
  async selected(text) {
    const request = ++copied
    let message = '已复制'
    try { await navigator.clipboard.writeText(text) } catch { message = '复制失败，可按 Ctrl+C / ⌘C 手动复制' }
    if (disposed || request !== copied) return
    copyMessage.value = message; clearTimeout(timer); timer = setTimeout(() => { copyMessage.value = '' }, 2000)
  },
})
function dimensions() {
  const term = surface.getTerminal(), fit = surface.getFit()
  if (!term || !fit || !host.value || !content.value) return
  // Measure against the visible viewport before widening the unwrapped terminal.
  content.value.style.width = `${host.value.clientWidth}px`
  const size = fit.proposeDimensions()
  if (!size) return
  let cols = size.cols
  if (!props.wrap) {
    for (const line of props.lines) {
      const plain = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      cols = Math.max(cols, ...plain.split(/[\r\n]/).map(part => (/^[\x20-\x7e]*$/.test(part) ? part.length : terminalGraphemes(part).reduce((sum, item) => sum + terminalCellWidth(item.text), 0)) + 1))
    }
  }
  const width = Math.ceil(host.value.clientWidth * cols / Math.max(1, size.cols))
  content.value.style.width = `${width}px`
  term.resize(Math.max(2, cols), Math.max(1, size.rows))
}
function schedule() { ++revision; if (pending || disposed) return; pending = true; queueMicrotask(render) }
function render() {
  const term = surface.getTerminal()
  if (!term || disposed || !props.active || !host.value?.clientWidth) { pending = false; return }
  const version = revision, next = [...props.lines], top = term.buffer.active.viewportY
  const reset = force || snapshot.length > next.length || snapshot.some((line, index) => next[index] !== line)
  writing = true; dimensions(); force = false
  if (reset) { term.reset(); snapshot = [] }
  const extra = next.slice(snapshot.length)
  // Separate records while preserving in-record carriage returns and ANSI instructions.
  const text = extra.map((line, index) => (snapshot.length || index ? '\r\n' : '') + line.replace(/\r?\n/g, '\r\n') + '\x1b[0m').join('')
  snapshot = next
  term.write(text, () => {
    if (disposed) return
    if (props.follow) term.scrollToBottom(); else term.scrollToLine(top)
    writing = false; pending = false
    if (version !== revision) schedule()
  })
}
watch(() => [...props.lines], schedule)
watch(() => props.wrap, () => { force = true; schedule() })
watch(() => props.follow, value => { if (value) surface.getTerminal()?.scrollToBottom() })
watch(() => props.active, value => { if (value) { force = true; surface.resize(); schedule() } })
watch(() => props.contextKey, () => { force = true; ++copied; copyMessage.value = ''; surface.getTerminal()?.clearSelection(); schedule() })
function scrollTop() { emit('update:follow', false); surface.getTerminal()?.scrollToTop() }
function scrollBottom() { surface.getTerminal()?.scrollToBottom() }
defineExpose({ scrollTop, scrollBottom })
onScopeDispose(() => { disposed = true; ++copied; clearTimeout(timer) })
</script>

<template>
  <div ref="host" class="xterm-log-viewport" :class="{ 'is-wrapped': wrap }" tabindex="0" aria-label="容器日志正文">
    <div ref="content" class="xterm-log-viewport__content" />
    <span v-if="copyMessage" class="xterm-log-viewport__copy" role="status">{{ copyMessage }}</span>
  </div>
</template>

<style scoped>
.xterm-log-viewport { position: relative; height: clamp(300px, 52vh, 680px); overflow-x: auto; overflow-y: hidden; min-width: 0; padding: 12px 0; }
.xterm-log-viewport__content { height: 100%; min-width: 100%; padding: 0 16px; }
.xterm-log-viewport :deep(.xterm) { height: 100%; }
.xterm-log-viewport :deep(.xterm-accessibility) { overflow: hidden; }
.xterm-log-viewport :deep(.xterm-viewport) { overscroll-behavior: contain; }
.xterm-log-viewport__copy { position: sticky; bottom: 16px; left: 45%; padding: 8px 16px; color: #000a14; background: #fff; border-radius: 8px; font-size: 12px; }
</style>
