import { EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type KeyBinding } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { codeSearchExtensions, createCodeSearchPanel, openCodeReplace, replaceCodeMatches } from './codeEditorSearch'

const colors = HighlightStyle.define([
  { tag: tags.propertyName, color: '#9cdcfe' },
  { tag: [tags.string, tags.content], color: '#ce9178' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b5cea8' },
  { tag: tags.comment, color: '#6a9955' },
  { tag: [tags.meta, tags.punctuation], color: '#d4d4d4' },
])
const theme = EditorView.theme({
  '&': { height: '100%', color: '#d4d4d4', backgroundColor: '#1e1e1e', fontSize: '12px', '--code-search-bg': '#252526', '--code-search-input': '#333', '--code-search-border': '#666', '--code-search-color': '#ddd', '--code-search-muted': '#aaa', '--code-search-error': '#ff8983', '--code-search-selected': '#8cbbff' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--tk-mono)', lineHeight: '20px' },
  '.cm-content': { padding: '12px 0', caretColor: '#fff' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: '0' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '28px' },
  '.cm-cursor': { borderLeftColor: '#fff' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#ffffff06' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#264f78 !important' },
  '&.cm-focused': { outline: '1px solid #448cff', outlineOffset: '-1px' },
  '.cm-panels': { backgroundColor: '#252526', color: '#ddd' },
  '.cm-textfield': { backgroundColor: '#333', color: '#eee', border: '1px solid #666', maxWidth: '150px' },
  '.cm-button': { background: '#333', color: '#eee', border: '1px solid #666' },
  '.cm-searchMatch': { backgroundColor: '#765b16', outline: '1px solid #a88223' },
  '.cm-searchMatch-selected': { backgroundColor: '#9d6500' },
  '.cm-foldPlaceholder': { backgroundColor: '#333', color: '#aaa', border: '0' },
}, { dark: true })

// Dockerfile and task scripts follow Devtron's light code-editor palette.
const lightColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.operator], color: '#d73a49' },
  { tag: [tags.string, tags.content], color: '#032f62' },
  { tag: [tags.number, tags.bool, tags.null], color: '#005cc5' },
  { tag: [tags.variableName, tags.propertyName], color: '#008080' },
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.meta, color: '#6f42c1' },
])
const lightTheme = EditorView.theme({
  '&': { height: '100%', color: '#1a2f65', backgroundColor: '#fff', fontSize: '14px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--tk-mono)', lineHeight: '20px' },
  '.cm-content': { padding: '10px 0', caretColor: '#000a14' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: '#f7fafc', color: '#89949e', border: '0' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '28px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#0066cc06' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#0066cc4d !important' },
  '&.cm-focused': { outline: '1px solid #0066cc', outlineOffset: '-1px' },
  '.cm-panels': { backgroundColor: '#f7fafc', color: '#3b444c' },
  '.cm-textfield': { backgroundColor: '#fff', color: '#1a2f65', border: '1px solid #b7c1cb', maxWidth: '150px' },
  '.cm-button': { background: '#fff', color: '#3b444c', border: '1px solid #b7c1cb' },
  '.cm-searchMatch': { backgroundColor: '#c58d3655' },
  '.cm-searchMatch-selected': { backgroundColor: '#0066cc4d' },
  '.cm-foldPlaceholder': { backgroundColor: '#edf1f5', color: '#596168', border: '0' },
})

export const codeEditorExtensions = (language: Extension, bindings: KeyBinding[] = [], appearance: 'dark' | 'light' = 'dark'): Extension[] => [
  language, lineNumbers(), foldGutter(), bracketMatching(), drawSelection(), history(),
  highlightActiveLine(), highlightActiveLineGutter(), indentUnit.of('  '), EditorState.tabSize.of(2),
  syntaxHighlighting(appearance === 'light' ? lightColors : colors), appearance === 'light' ? lightTheme : theme,
  codeSearchExtensions, search({ top: true, createPanel: createCodeSearchPanel }), codeSearchTheme,
  EditorView.contentAttributes.of({ 'aria-multiline': 'true', tabindex: '0' }),
  EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一项', 'previous': '上一项', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则', 'by word': '全词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', '$ unchanged lines': '$ 行未修改内容' }),
  keymap.of([
    ...bindings,
    { key: 'Mod-h', run: openCodeReplace, scope: 'editor search-panel', preventDefault: true },
    { key: 'Mod-Alt-f', run: openCodeReplace, scope: 'editor search-panel', preventDefault: true },
    { key: 'Mod-Enter', run: replaceCodeMatches, scope: 'search-panel', preventDefault: true },
    { key: 'Mod-Alt-Enter', run: replaceCodeMatches, scope: 'search-panel', preventDefault: true },
    { key: 'Tab', run: indentWithTab.run }, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap,
  ]),
]

const codeSearchTheme = EditorView.theme({
  '.cm-panels:has(.cm-code-search)': { border: '0', backgroundColor: 'transparent', overflow: 'hidden' },
  '.cm-code-search.cm-search': { padding: '0', margin: '8px 8px 4px auto', width: 'fit-content', maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box' },
  '&.cm-editor .cm-code-search input': { maxWidth: 'none' },
})
