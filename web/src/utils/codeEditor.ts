import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { closeSearchPanel, openSearchPanel } from '@codemirror/search'

export interface CodeEditorOptions {
  extensions: () => Extension
  configuration?: Extension
  context?: string
  invalid?: boolean
  text: string
  label: string
  readonly: boolean
  autofocus: boolean
  change: (text: string) => void
}

export function createCodeEditor(parent: HTMLElement, options: CodeEditorOptions) {
  const access = new Compartment()
  const configuration = new Compartment()
  let configured = options.configuration ?? []
  let label = options.label, readonly = options.readonly, context = options.context ?? '', invalid = options.invalid ?? false, destroyed = false
  const accessExtensions = () => [
    EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly),
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': String(readonly), 'aria-invalid': String(invalid) }),
  ]
  const state = (text: string, selection = 0) => EditorState.create({
    doc: text, selection: EditorSelection.cursor(Math.min(selection, text.length)),
    extensions: [options.extensions(), configuration.of(configured), access.of(accessExtensions()), EditorView.updateListener.of(update => {
      if (update.docChanged) options.change(update.state.doc.toString())
    })],
  })
  const view = new EditorView({ parent, state: state(options.text) })
  if (options.autofocus && !readonly) view.focus()
  return {
    configure(extensions: Extension, apply?: (view: EditorView) => void) {
      if (destroyed) return
      configured = extensions
      view.dispatch({ effects: configuration.reconfigure(configured) })
      apply?.(view)
    },
    update(text: string, nextReadonly: boolean, nextLabel: string, nextContext = '', nextInvalid = false) {
      if (destroyed) return
      const reconfigure = readonly !== nextReadonly || label !== nextLabel || context !== nextContext
      readonly = nextReadonly; label = nextLabel; context = nextContext
      const validationChanged = invalid !== nextInvalid
      invalid = nextInvalid
      if (view.state.doc.toString() !== text || reconfigure) {
        const { scrollTop, scrollLeft } = view.scrollDOM
        // Replaced resource snapshots start a new history; undo must never restore another resource.
        // Access changes also discard history, including when a masked Secret has identical text.
        view.setState(state(text, view.state.selection.main.head))
        view.scrollDOM.scrollTop = scrollTop; view.scrollDOM.scrollLeft = scrollLeft
      } else if (validationChanged) view.dispatch({ effects: access.reconfigure(accessExtensions()) })
    },
    focus() { if (!destroyed && !readonly) view.focus() },
    search() { if (!destroyed) openSearchPanel(view) },
    closeSearch() {
      if (destroyed || !closeSearchPanel(view)) return false
      view.focus()
      return true
    },
    revealLine(line: number, focus = false) {
      if (destroyed) return
      const target = view.state.doc.line(Math.max(1, Math.min(Math.trunc(line) || 1, view.state.doc.lines)))
      view.dispatch({ selection: EditorSelection.range(target.from, target.to), effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
      if (focus) view.focus()
    },
    destroy() { destroyed = true; view.destroy() },
  }
}
