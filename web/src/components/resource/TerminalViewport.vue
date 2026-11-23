<script setup lang="ts">
import { onScopeDispose, useTemplateRef, watch } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { useXtermSurface } from '@/composables/useXtermSurface'
import { cleanTerminalInput, limitTerminalInput, terminalGraphemes, terminalInputLayout, terminalNeedsContinuation } from '@/utils/terminalInput'

const props = defineProps<{ lines: string[]; input: string; prompt: string; connected: boolean; active: boolean; label: string; busy?: boolean; contextKey: string }>()
const emit = defineEmits<{
  'update:input': [value: string]; submit: []; recall: [direction: -1 | 1]; interrupt: []; disconnect: []; clear: []; selected: [text: string]
}>()
const host = useTemplateRef<HTMLElement>('host')
let draft = props.input, cursor = draft.length, renderedCursorRow = 0, snapshot: string[] = [], pending = false, force = true, disposed = false
let revision = 0
const surface = useXtermSurface(host, { label: () => props.label, interactive: true, active: () => props.active,
  resize() { const term = surface.getTerminal(), fit = surface.getFit(); if (!term || !fit) return; fit.fit(); force = true; schedule() },
  ready(term) {
    term.onData(data)
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      if (event.key === 'Tab' || event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f')) return false
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) return false
      if ((event.ctrlKey && event.key.toLowerCase() === 'l') || (event.metaKey && event.key.toLowerCase() === 'k')) { event.preventDefault(); emit('clear'); return false }
      if (event.shiftKey && event.key === 'Enter') { event.preventDefault(); if (props.connected && !props.busy) insert('\n'); return false }
      return true
    })
    schedule()
  }, selected: text => emit('selected', text),
})
function edit(value: string, nextCursor: number) { draft = limitTerminalInput(value); cursor = Math.min(nextCursor, draft.length); emit('update:input', draft); schedule() }
function insert(value: string) { const text = cleanTerminalInput(value); edit(draft.slice(0, cursor) + text + draft.slice(cursor), cursor + text.length) }
function move(direction: -1 | 1) {
  const items = terminalGraphemes(draft)
  cursor = direction === -1 ? items.filter(item => item.start < cursor).at(-1)?.start ?? 0 : items.find(item => item.end > cursor)?.end ?? draft.length
  schedule()
}
function data(value: string) {
  if (!props.connected) return
  if (value === '\x03') { emit('interrupt'); return }
  if (props.busy) return
  if (value.startsWith('\x1b[200~') && value.endsWith('\x1b[201~')) { insert(value.slice(6, -6)); return }
  if (value === '\r') {
    if (terminalNeedsContinuation(draft)) insert('\n')
    else { cursor = 0; emit('submit') }
    return
  }
  if (value === '\x1b[A' || value === '\x1b[B') { emit('recall', value.endsWith('A') ? -1 : 1); return }
  if (value === '\x1b[D') { move(-1); return }
  if (value === '\x1b[C') { move(1); return }
  if (['\x01', '\x1b[H', '\x1bOH', '\x1b[1~'].includes(value)) { cursor = cursor === 0 ? 0 : draft.lastIndexOf('\n', cursor - 1) + 1; schedule(); return }
  if (['\x05', '\x1b[F', '\x1bOF', '\x1b[4~'].includes(value)) { const next = draft.indexOf('\n', cursor); cursor = next < 0 ? draft.length : next; schedule(); return }
  if (value === '\x7f' || value === '\b') { const before = cursor; move(-1); edit(draft.slice(0, cursor) + draft.slice(before), cursor); return }
  if (value === '\x1b[3~' || value === '\x04') {
    if (!draft && value === '\x04') emit('disconnect')
    else { const before = cursor; move(1); edit(draft.slice(0, before) + draft.slice(cursor), before) }
    return
  }
  if (value === '\x15') { edit(draft.slice(cursor), 0); return }
  if (value === '\x0b') { edit(draft.slice(0, cursor), cursor); return }
  if (value === '\x17') { const start = draft.slice(0, cursor).replace(/\S+\s*$/, '').length; edit(draft.slice(0, start) + draft.slice(cursor), start); return }
  if (value === '\x0c') { emit('clear'); return }
  // Unknown function/escape sequences must not appear as literal command text.
  if (value.startsWith('\x1b')) return
  insert(value)
}
function syncInput(term: Terminal) {
  term.options.disableStdin = !props.connected
  term.options.cursorBlink = props.connected
  if (term.textarea) { term.textarea.disabled = !props.connected; term.textarea.setAttribute('aria-busy', String(!!props.busy)) }
}
function schedule() {
  ++revision
  if (pending || disposed) return
  pending = true
  queueMicrotask(render)
}
function render() {
  const term = surface.getTerminal()
  if (!term || disposed) { pending = false; return }
  const version = revision, next = [...props.lines]
  const reset = force || snapshot.length > next.length || snapshot.some((line, index) => next[index] !== line)
  force = false; syncInput(term)
  if (reset) { term.reset(); snapshot = []; renderedCursorRow = 0 }
  let text = reset ? '' : '\r' + (renderedCursorRow ? `\x1b[${renderedCursorRow}A` : '') + '\x1b[J'
  const appended = next.slice(snapshot.length)
  for (const line of appended) text += line.replace(/\r?\n/g, '\r\n') + '\x1b[0m\r\n'
  snapshot = next
  text += '\x1b[?2004h'
  const layout = terminalInputLayout(props.prompt, draft, Math.max(2, term.cols), cursor)
  // Keep a very long draft's editable cursor visible without moving into prior output.
  const start = Math.max(0, layout.cursorRow - Math.max(1, term.rows - 2))
  const visible = layout.rows.slice(start, Math.max(layout.cursorRow + 1, Math.min(layout.rows.length, start + term.rows - 1)))
  text += visible.join('\r\n')
  const up = visible.length - 1 - (layout.cursorRow - start)
  text += '\r' + (up ? `\x1b[${up}A` : '') + (layout.cursorColumn ? `\x1b[${layout.cursorColumn}C` : '')
  renderedCursorRow = layout.cursorRow - start
  term.write(text, () => { pending = false; if (!disposed && revision !== version) schedule() })
}
watch(() => props.input, value => { if (value !== draft) { draft = value; cursor = draft.length }; schedule() })
watch(() => [...props.lines], schedule)
watch(() => [props.connected, props.prompt, props.busy], schedule)
watch(() => props.contextKey, () => { draft = props.input; cursor = draft.length; force = true; surface.getTerminal()?.clearSelection(); schedule() })
watch(() => props.active, active => { if (active) { surface.resize(); if (props.connected) focus() } })
watch(() => props.connected, connected => { if (connected && props.active) focus() })
function focus() { if (props.active && props.connected) surface.getTerminal()?.focus() }
defineExpose({ focus })
onScopeDispose(() => { disposed = true })
</script>

<template><div ref="host" class="terminal-viewport" :aria-label="label + '输出'" /></template>

<style scoped>
.terminal-viewport { position: absolute; inset: 0; min-width: 0; overflow: hidden; padding: 12px 16px; }
.terminal-viewport :deep(.xterm) { height: 100%; }
.terminal-viewport :deep(.xterm-accessibility) { overflow: hidden; }
.terminal-viewport :deep(.xterm-viewport) { overscroll-behavior: contain; }
</style>
