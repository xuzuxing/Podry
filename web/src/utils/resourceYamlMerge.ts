import { Compartment, EditorSelection, EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView, uncollapseUnchanged } from '@codemirror/merge'
import { closeSearchPanel, openSearchPanel } from '@codemirror/search'

import { resourceYamlExtensions } from './resourceYamlSetup'
import { createResourceDiffMinimap } from './resourceDiffMinimap'
import { resourceYamlSyntax } from './resourceYamlSyntax'

export interface ManifestDiffPosition { total: number; current: number }
interface MergeOptions {
  original: string
  modified: string
  originalLabel: string
  modifiedLabel: string
  readonly: boolean
  collapseUnchanged?: boolean
  change: (text: string) => void
  position: (position: ManifestDiffPosition) => void
}

/** Native CodeMirror merge views align unchanged lines with spacers; no padding is added to either document. */
export function createResourceYamlMerge(parent: HTMLElement, options: MergeOptions) {
  const editable = new Compartment()
  const originalSyntax = new Compartment(), modifiedSyntax = new Compartment()
  const originalLabel = new Compartment(), modifiedLabel = new Compartment()
  let collapsed = Boolean(options.collapseUnchanged)
  let current = -1, updating = false, destroyed = false
  let minimap: ReturnType<typeof createResourceDiffMinimap> | undefined
  const readonly = (value: boolean): Extension => [EditorState.readOnly.of(value), EditorView.editable.of(!value)]
  const shared = () => [
    resourceYamlExtensions([{ key: 'F7', run: () => { navigate(1); return true }, shift: () => { navigate(-1); return true } }], false),
    EditorView.updateListener.of(update => {
      if (update.docChanged || update.geometryChanged) minimap?.refresh()
      if (!collapsed || !update.transactions.some(transaction => transaction.isUserEvent('select.search'))) return
      // Native merge ranges do not automatically expand for search selections.
      // Schedule after the view update, then reveal only the matching ranges in both panes.
      const selection = update.state.selection
      queueMicrotask(() => {
        if (destroyed || !collapsed || !selection.eq(update.view.state.selection)) return
        const starts = new Set<number>()
        for (const source of update.view.state.facet(EditorView.decorations)) {
          if (typeof source === 'function') continue
          for (const range of selection.ranges) source.between(range.from, range.to, (from, to, decoration) => {
            if (from < to && decoration.spec.block && decoration.spec.widget) starts.add(from)
          })
        }
        if (!starts.size) return
        const isOriginal = update.view === merge.a, sibling = isOriginal ? merge.b : merge.a
        const mapped = [...starts].map(start => {
          let offset = 0
          for (const chunk of merge.chunks) {
            if ((isOriginal ? chunk.fromA : chunk.fromB) >= start) break
            offset = isOriginal ? chunk.toB - chunk.toA : chunk.toA - chunk.toB
          }
          return start + offset
        })
        update.view.dispatch({ effects: [...starts].map(start => uncollapseUnchanged.of(start)) })
        sibling.dispatch({ effects: mapped.map(start => uncollapseUnchanged.of(start)) })
        update.view.dispatch({ effects: EditorView.scrollIntoView(selection.main, { y: 'center' }) })
      })
    }),
  ]
  function report() { options.position({ total: merge.chunks.length, current: current + 1 }) }
  const merge = new MergeView({
    parent,
    a: { doc: options.original, extensions: [...shared(), originalSyntax.of(collapsed ? [] : resourceYamlSyntax()), originalLabel.of(EditorView.contentAttributes.of({ 'aria-label': options.originalLabel })), readonly(true)] },
    b: { doc: options.modified, extensions: [...shared(), modifiedSyntax.of(collapsed ? [] : resourceYamlSyntax()), modifiedLabel.of(EditorView.contentAttributes.of({ 'aria-label': options.modifiedLabel })), editable.of(readonly(options.readonly)), EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      current = -1
      if (!updating) options.change(update.state.doc.toString())
      report()
    })] },
    highlightChanges: true, gutter: true, diffConfig: { scanLimit: 2_000, timeout: 100 },
    collapseUnchanged: collapsed ? { margin: 0, minSize: 1 } : undefined,
  })
  merge.a.contentDOM.setAttribute('aria-readonly', 'true')
  merge.b.contentDOM.setAttribute('aria-readonly', String(options.readonly))
  minimap = createResourceDiffMinimap(parent, merge)
  minimap.setEnabled(!collapsed)
  // 短清单的程序滚动不反向驱动另一栏，保留原编辑器的滚动保护。
  // 短清单会截断滚动位置；此处的程序滚动不再反向驱动另一栏。
  const mirrored = new WeakMap<HTMLElement, { top: number; left: number }>()
  function synchronize(from: HTMLElement, to: HTMLElement) {
    const position = mirrored.get(from)
    if (position?.top === from.scrollTop && position.left === from.scrollLeft) { mirrored.delete(from); return }
    mirrored.delete(from)
    to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft
    mirrored.set(to, { top: to.scrollTop, left: to.scrollLeft })
  }
  const leftScroll = () => synchronize(merge.a.scrollDOM, merge.b.scrollDOM)
  const rightScroll = () => synchronize(merge.b.scrollDOM, merge.a.scrollDOM)
  merge.a.scrollDOM.addEventListener('scroll', leftScroll)
  merge.b.scrollDOM.addEventListener('scroll', rightScroll)
  report()
  function navigate(direction: number) {
    if (destroyed || !merge.chunks.length) return
    current = current < 0 ? direction > 0 ? 0 : merge.chunks.length - 1 : (current + direction + merge.chunks.length) % merge.chunks.length
    const chunk = merge.chunks[current]!
    for (const [view, from, to] of [[merge.a, chunk.fromA, chunk.toA], [merge.b, chunk.fromB, chunk.toB]] as const) {
      const start = Math.min(from, view.state.doc.length), end = Math.min(to, view.state.doc.length)
      const line = view.state.doc.lineAt(start)
      const selection = EditorSelection.range(start === end ? line.from : start, start === end ? line.to : end)
      view.dispatch({ selection, effects: EditorView.scrollIntoView(selection, { y: 'center' }) })
    }
    merge.b.focus(); report()
  }
  return {
    update(original: string, modified: string, isReadonly: boolean, collapseUnchanged: boolean, nextOriginalLabel: string, nextModifiedLabel: string) {
      if (destroyed) return
      updating = true
      try {
        let replaced = false
        for (const [view, text] of [[merge.a, original], [merge.b, modified]] as const) {
          if (view.state.doc.toString() === text) continue
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) })
          current = -1; replaced = true
        }
        merge.b.dispatch({ effects: editable.reconfigure(readonly(isReadonly)) })
        merge.a.dispatch({ effects: originalLabel.reconfigure(EditorView.contentAttributes.of({ 'aria-label': nextOriginalLabel })) })
        merge.b.dispatch({ effects: modifiedLabel.reconfigure(EditorView.contentAttributes.of({ 'aria-label': nextModifiedLabel })) })
        merge.b.contentDOM.setAttribute('aria-readonly', String(isReadonly))
        if (collapsed !== collapseUnchanged || replaced && collapsed) {
          // Replaced snapshots need newly computed collapsed ranges, rather than mapped old ranges.
          if (collapsed) merge.reconfigure({ collapseUnchanged: undefined })
          collapsed = collapseUnchanged
          merge.reconfigure({ collapseUnchanged: collapsed ? { margin: 0, minSize: 1 } : undefined })
          // Upstream excludes syntax diagnostics from its collapsed comparison mode.
          merge.a.dispatch({ effects: originalSyntax.reconfigure(collapsed ? [] : resourceYamlSyntax()) })
          merge.b.dispatch({ effects: modifiedSyntax.reconfigure(collapsed ? [] : resourceYamlSyntax()) })
        }
      } finally { updating = false }
      minimap?.setEnabled(!collapsed)
      minimap?.refresh()
      report()
    },
    navigate,
    search(side: 'original' | 'modified') { if (!destroyed) { const view = side === 'original' ? merge.a : merge.b; openSearchPanel(view) } },
    closeSearch(target: EventTarget | null) {
      if (destroyed || !(target instanceof Node)) return false
      const view = merge.a.dom.contains(target) ? merge.a : merge.b.dom.contains(target) ? merge.b : undefined
      if (!view || !closeSearchPanel(view)) return false
      view.focus(); return true
    },
    destroy() {
      destroyed = true
      minimap?.destroy()
      merge.a.scrollDOM.removeEventListener('scroll', leftScroll)
      merge.b.scrollDOM.removeEventListener('scroll', rightScroll)
      merge.destroy()
    },
  }
}
