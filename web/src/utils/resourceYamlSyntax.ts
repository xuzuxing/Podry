import { linter, lintKeymap, type Diagnostic } from '@codemirror/lint'
import { EditorView, keymap } from '@codemirror/view'
import { parseAllDocuments } from 'yaml'

/** Diagnostics describe the document; only the parent form decides whether it can be saved. */
export function yamlSyntaxDiagnostics(text: string): Diagnostic[] {
  return parseAllDocuments(text).flatMap(document => document.errors.map(error => {
    const from = Math.min(text.length, Math.max(0, error.pos[0]))
    return { from, to: Math.min(text.length, Math.max(from, error.pos[1])), severity: 'error' as const, source: error.name, message: error.message }
  }))
}

export const resourceYamlSyntax = () => [
  linter(view => yamlSyntaxDiagnostics(view.state.doc.toString()), { delay: 400 }),
  keymap.of(lintKeymap), yamlDiagnosticTheme,
]

const yamlDiagnosticTheme = EditorView.theme({
  '.cm-tooltip': { maxWidth: 'min(480px, calc(100vw - 32px))', backgroundColor: '#252526', color: '#ddd', border: '1px solid #666', borderRadius: '4px' },
  '.cm-diagnostic': { padding: '6px 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px', lineHeight: '18px' },
  '.yaml-schema-hover': { padding: '10px 12px', fontSize: '12px', lineHeight: '18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  '.yaml-schema-hover code': { display: 'block', marginTop: '6px', color: '#9cdcfe' },
  '.cm-tooltip-autocomplete ul': { fontFamily: 'var(--tk-mono)', fontSize: '12px', maxWidth: 'min(460px, calc(100vw - 32px))' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#264f78', color: '#fff' },
  '.cm-completionDetail': { color: '#aaa' },
})
