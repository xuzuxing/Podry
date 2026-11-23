import type { MergeView } from '@codemirror/merge'

let nextId = 0

/** A bounded canvas overview uses the merge's measured blocks, including insertion spacers. */
export function createResourceDiffMinimap(parent: HTMLElement, merge: MergeView) {
  const rail = document.createElement('div'), canvas = document.createElement('canvas'), thumb = document.createElement('div')
  rail.className = 'resource-diff-minimap'
  rail.tabIndex = 0
  rail.setAttribute('role', 'scrollbar')
  rail.setAttribute('aria-label', '差异缩略图')
  rail.setAttribute('aria-orientation', 'vertical')
  rail.setAttribute('aria-valuemin', '0')
  rail.setAttribute('aria-valuemax', '100')
  const id = `resource-diff-document-${++nextId}`
  merge.dom.id = id
  rail.setAttribute('aria-controls', id)
  canvas.setAttribute('aria-hidden', 'true')
  thumb.className = 'resource-diff-minimap__viewport'
  thumb.setAttribute('aria-hidden', 'true')
  rail.append(canvas, thumb); parent.append(rail)
  let disposed = false, enabled = true, frame = 0, repaint = true
  let height = 0, thumbHeight = 0, thumbTop = 0
  let active = merge.b, pointer: number | undefined, grabOffset = 0
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))
  const range = () => Math.max(0, active.scrollDOM.scrollHeight - active.scrollDOM.clientHeight)

  function draw() {
    const width = rail.clientWidth, ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
    const context = canvas.getContext('2d')
    if (!context || !width || !height) return
    context.scale(ratio, ratio)
    context.fillStyle = '#1e1e1e'; context.fillRect(0, 0, width, height)
    const contentHeight = Math.max(merge.a.contentHeight, merge.b.contentHeight, height)
    const scale = height / contentHeight, half = width / 2
    // Match both columns and changed blocks without cloning contenteditable editor DOM.
    for (const [view, side] of [[merge.a, 0], [merge.b, 1]] as const) {
      context.save(); context.beginPath(); context.rect(side * half, 0, half, height); context.clip()
      context.fillStyle = side ? '#246e3b' : '#943c43'
      for (const chunk of merge.chunks) {
        const from = Math.min(side ? chunk.fromB : chunk.fromA, view.state.doc.length)
        const to = Math.min(side ? chunk.toB : chunk.toA, view.state.doc.length)
        if (from === to) continue
        const first = view.lineBlockAt(from), last = view.lineBlockAt(Math.max(from, to - 1))
        context.fillRect(side * half, first.top * scale, half, Math.max(1, (last.bottom - first.top) * scale))
      }
      context.fillStyle = '#aeb5bf'
      context.font = `${Math.max(0.5, Math.min(2, view.defaultCharacterWidth * 2 * scale))}px monospace`
      context.textBaseline = 'top'
      let previous = -1
      // At most two samples per output pixel, independent of the document's line count.
      for (let y = 0; y < Math.min(height, view.contentHeight * scale); y += 0.5) {
        const block = view.lineBlockAtHeight(y / scale)
        if (block.from === previous) continue
        previous = block.from
        const line = view.state.doc.lineAt(block.from)
        context.fillText(line.text.slice(0, 200), side * half + 1, block.top * scale)
      }
      context.restore()
    }
    context.fillStyle = '#555'; context.fillRect(half, 0, 0.5, height)
  }
  function refresh(redraw = true) {
    repaint ||= redraw
    if (disposed || !enabled || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed || !enabled) return
      height = rail.clientHeight
      if (!height) return
      if (repaint) { draw(); repaint = false }
      const area = active.scrollDOM, max = range()
      thumbHeight = Math.min(height, Math.max(20, height * area.clientHeight / Math.max(area.scrollHeight, 1)))
      thumbTop = max ? clamp(area.scrollTop / max, 1) * (height - thumbHeight) : 0
      thumb.style.height = `${thumbHeight}px`; thumb.style.transform = `translateY(${thumbTop}px)`
      rail.setAttribute('aria-valuenow', String(max ? Math.round(clamp(area.scrollTop / max, 1) * 100) : 0))
      rail.setAttribute('aria-valuetext', max ? `已滚动 ${rail.getAttribute('aria-valuenow')}%` : '已显示全部内容')
    })
  }
  function scrollTo(top: number) {
    const target = clamp(top, range())
    active.scrollDOM.scrollTop = target
    // Either pane may have a shorter scroll range, especially during an insertion or search.
    const sibling = active === merge.a ? merge.b : merge.a
    sibling.scrollDOM.scrollTop = target
    refresh(false)
  }
  function move(clientY: number) {
    const travel = height - thumbHeight
    scrollTo(travel > 0 ? (clientY - rail.getBoundingClientRect().top - grabOffset) / travel * range() : 0)
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || !enabled) return
    event.preventDefault(); rail.focus({ preventScroll: true })
    pointer = event.pointerId
    grabOffset = event.target === thumb ? event.clientY - rail.getBoundingClientRect().top - thumbTop : thumbHeight / 2
    rail.setPointerCapture(pointer); rail.classList.add('resource-diff-minimap--dragging')
    move(event.clientY)
  }
  function pointerMove(event: PointerEvent) { if (pointer === event.pointerId) move(event.clientY) }
  function releasePointer() {
    if (pointer !== undefined && rail.hasPointerCapture(pointer)) rail.releasePointerCapture(pointer)
    pointer = undefined; rail.classList.remove('resource-diff-minimap--dragging')
  }
  function keydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const page = active.scrollDOM.clientHeight
    const delta = { ArrowUp: -active.defaultLineHeight, ArrowDown: active.defaultLineHeight, PageUp: -page, PageDown: page }[event.key]
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault(); event.stopPropagation()
    scrollTo(event.key === 'Home' ? 0 : event.key === 'End' ? range() : active.scrollDOM.scrollTop + delta!)
  }
  const leftScroll = () => { active = merge.a; refresh(false) }
  const rightScroll = () => { active = merge.b; refresh(false) }
  merge.a.scrollDOM.addEventListener('scroll', leftScroll)
  merge.b.scrollDOM.addEventListener('scroll', rightScroll)
  rail.addEventListener('pointerdown', pointerDown); rail.addEventListener('pointermove', pointerMove)
  rail.addEventListener('pointerup', releasePointer); rail.addEventListener('pointercancel', releasePointer)
  rail.addEventListener('lostpointercapture', releasePointer); rail.addEventListener('keydown', keydown)
  const observer = new ResizeObserver(() => refresh())
  observer.observe(rail); observer.observe(merge.a.scrollDOM); observer.observe(merge.b.scrollDOM)
  let density = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
  function densityChanged() {
    density.removeEventListener('change', densityChanged)
    density = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    density.addEventListener('change', densityChanged)
    refresh()
  }
  density.addEventListener('change', densityChanged)
  refresh()
  return {
    refresh,
    setEnabled(value: boolean) {
      if (enabled === value) return
      enabled = value
      if (!value) {
        if (rail.contains(document.activeElement)) merge.b.focus()
        releasePointer()
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      }
      rail.hidden = !value
      if (value) refresh()
    },
    destroy() {
      disposed = true; releasePointer(); observer.disconnect()
      density.removeEventListener('change', densityChanged)
      if (frame) cancelAnimationFrame(frame)
      merge.a.scrollDOM.removeEventListener('scroll', leftScroll)
      merge.b.scrollDOM.removeEventListener('scroll', rightScroll)
      rail.removeEventListener('pointerdown', pointerDown); rail.removeEventListener('pointermove', pointerMove)
      rail.removeEventListener('pointerup', releasePointer); rail.removeEventListener('pointercancel', releasePointer)
      rail.removeEventListener('lostpointercapture', releasePointer); rail.removeEventListener('keydown', keydown)
      rail.remove()
    },
  }
}
