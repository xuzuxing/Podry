import { onMounted, onScopeDispose, watch, type ShallowRef } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import '@/styles/xterm.less'

/** Owns the renderer and its lifetime; sessions and business drafts stay with callers. */
export function useXtermSurface(host: Readonly<ShallowRef<HTMLElement | null>>, options: {
  label: () => string
  interactive: boolean
  active: () => boolean
  resize: () => void
  ready: (terminal: Terminal, fit: FitAddon) => void
  selected: (text: string) => void
  resizeTarget?: () => HTMLElement | null
}) {
  let terminal: Terminal | undefined, fit: FitAddon | undefined, observer: ResizeObserver | undefined, frame = 0, alive = true
  function resize() {
    if (!alive) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (terminal && options.active() && host.value?.clientWidth && host.value.clientHeight) options.resize()
    })
  }
  onMounted(() => {
    if (!host.value) return
    terminal = new Terminal({
      scrollback: 99999, fontSize: 14, lineHeight: 1.4,
      fontFamily: "Consolas, 'Courier New', monospace", screenReaderMode: true,
      cursorBlink: options.interactive, cursorStyle: options.interactive ? 'block' : 'bar',
      disableStdin: !options.interactive, allowProposedApi: false,
      theme: { background: '#181920', foreground: '#ffffff', cursor: '#ffffff', selectionBackground: '#48536d' },
    })
    fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.value)
    terminal.element?.classList.add('podry-xterm')
    terminal.textarea?.setAttribute('aria-label', options.label())
    terminal.onSelectionChange(() => { const text = terminal?.getSelection(); if (text) options.selected(text) })
    observer = new ResizeObserver(resize); observer.observe(options.resizeTarget?.() ?? host.value)
    options.ready(terminal, fit); resize()
    void document.fonts.ready.then(resize)
  })
  watch(options.active, resize)
  onScopeDispose(() => { alive = false; cancelAnimationFrame(frame); observer?.disconnect(); terminal?.dispose(); terminal = undefined; fit = undefined })
  return { resize, getTerminal: () => terminal, getFit: () => fit }
}
