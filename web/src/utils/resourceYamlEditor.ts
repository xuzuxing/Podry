import { createCodeEditor, type CodeEditorOptions } from './codeEditor'
import { resourceYamlExtensions } from './resourceYamlSetup'
import { resourceYamlValidation, type ResourceYamlSchema } from './resourceYamlValidation'
import { updateSchema } from 'codemirror-json-schema'

export function createResourceYamlEditor(parent: HTMLElement, options: Omit<CodeEditorOptions, 'extensions' | 'configuration' | 'context' | 'invalid'> & { validatorSchema?: ResourceYamlSchema }) {
  let schema = options.validatorSchema
  const editor = createCodeEditor(parent, { ...options, extensions: resourceYamlExtensions, configuration: resourceYamlValidation(schema) })
  return {
    ...editor,
    update(text: string, readonly: boolean, label: string, nextSchema?: ResourceYamlSchema) {
      editor.update(text, readonly, label)
      if (schema !== nextSchema) {
        schema = nextSchema
        editor.configure(resourceYamlValidation(schema), view => { if (schema && Object.keys(schema).length) updateSchema(view, schema) })
      }
    },
  }
}
