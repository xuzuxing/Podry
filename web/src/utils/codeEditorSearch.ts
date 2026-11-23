import { h, render } from 'vue'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { EditorView, runScopeHandlers, type Panel } from '@codemirror/view'
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, SearchQuery, selectMatches, setSearchQuery } from '@codemirror/search'
import CodeEditorSearchPanel from '@/components/editor/CodeEditorSearchPanel.vue'

export interface CodeSearchValues { search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }
export interface CodeSearchSnapshot { query: CodeSearchValues; count: number; current: number; valid: boolean; readonly: boolean }
export type CodeSearchAction = 'previous' | 'next' | 'select' | 'replace' | 'replaceAll' | 'close'
const expandReplace = StateEffect.define<boolean>()
const replaceExpanded = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    if (transaction.state.readOnly) return false
    for (const effect of transaction.effects) if (effect.is(expandReplace)) value = effect.value
    return value
  },
})

export function openCodeReplace(view: EditorView): boolean {
  openSearchPanel(view)
  if (!view.state.readOnly) view.dispatch({ effects: expandReplace.of(true) })
  return true
}

export function replaceCodeMatches(view: EditorView): boolean {
  if (!view.state.readOnly && view.state.field(replaceExpanded) && getSearchQuery(view.state).valid) replaceAll(view)
  return true
}

/** Vue owns panel presentation; CodeMirror owns queries, selections, replacements and undo. */
export function createCodeSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-search cm-code-search'
  let disposed = false
  let query: SearchQuery | undefined, doc = view.state.doc
  let matches: { from: number; to: number }[] = []
  function snapshot(): CodeSearchSnapshot {
    const next = getSearchQuery(view.state)
    if (!query?.eq(next) || doc !== view.state.doc) {
      query = next; doc = view.state.doc; matches = []
      if (next.valid) {
        const cursor = next.getCursor(view.state)
        for (let item = cursor.next(); !item.done; item = cursor.next()) matches.push(item.value)
      }
    }
    const selection = view.state.selection.main
    // Upstream reports the match at or immediately before the current selection.
    let current = 1
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index]!
      if (match.from < selection.from || match.from === selection.from && match.to === selection.to) { current = index + 1; break }
    }
    return { query: next, count: matches.length, current, valid: next.valid, readonly: view.state.readOnly }
  }
  function commit(patch: Partial<CodeSearchValues>) {
    const query = new SearchQuery({ ...getSearchQuery(view.state), ...patch })
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) })
  }
  function action(action: CodeSearchAction) {
    if (disposed) return
    if (action !== 'close' && !getSearchQuery(view.state).valid) return
    // Check access at the time of the action, including a readonly reconfiguration.
    if (view.state.readOnly && (action === 'replace' || action === 'replaceAll')) return
    const commands = { previous: findPrevious, next: findNext, select: selectMatches, replace: replaceNext, replaceAll, close: closeSearchPanel }
    commands[action](view)
    if (action === 'close') view.focus()
  }
  function draw() {
    const expanded = !view.state.readOnly && view.state.field(replaceExpanded)
    render(h(CodeEditorSearchPanel, { snapshot: snapshot(), expanded, onQuery: commit, onAction: action, onToggle: () => view.dispatch({ effects: expandReplace.of(!expanded) }) }), dom)
  }
  dom.addEventListener('keydown', event => {
    if (runScopeHandlers(view, event, 'search-panel')) { event.preventDefault(); event.stopPropagation(); return }
    const target = event.target as HTMLInputElement
    if (event.key === 'Enter' && target.matches('input')) {
      event.preventDefault()
      action(target.name === 'replace' ? 'replace' : event.shiftKey ? 'previous' : 'next')
    }
    // Panel typing must not trigger surrounding drawer/page shortcuts.
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key !== 'Tab') event.stopPropagation()
  })
  draw()
  return {
    dom, top: true,
    mount() { dom.querySelector<HTMLInputElement>('input[name=search]')?.select() },
    update() { draw() },
    destroy() { disposed = true; render(null, dom); matches = []; query = undefined },
  }
}

export const codeSearchExtensions = [EditorState.allowMultipleSelections.of(true), replaceExpanded]
