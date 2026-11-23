import type { KeyBinding } from '@codemirror/view'
import { yaml } from '@codemirror/lang-yaml'
import { codeEditorExtensions } from './codeEditorSetup'
import { resourceYamlSyntax } from './resourceYamlSyntax'

export const resourceYamlExtensions = (bindings: KeyBinding[] = [], validate = true) => [
  ...codeEditorExtensions(yaml(), bindings), ...validate ? resourceYamlSyntax() : [],
]
