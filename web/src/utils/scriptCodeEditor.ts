import { StreamLanguage } from '@codemirror/language'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { createCodeEditor, type CodeEditorOptions } from './codeEditor'
import { codeEditorExtensions } from './codeEditorSetup'

export function createScriptCodeEditor(parent: HTMLElement, options: Omit<CodeEditorOptions, 'extensions'> & { language: 'dockerfile' | 'shell' }) {
  const language = StreamLanguage.define(options.language === 'dockerfile' ? dockerFile : shell)
  return createCodeEditor(parent, { ...options, extensions: () => codeEditorExtensions(language, [], 'light') })
}
