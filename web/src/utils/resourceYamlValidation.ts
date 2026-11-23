import { autocompletion, closeCompletion, completionKeymap, CompletionContext } from '@codemirror/autocomplete'
import { yamlLanguage } from '@codemirror/lang-yaml'
import { linter } from '@codemirror/lint'
import { EditorView, hoverTooltip, keymap } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'
import { handleRefresh, stateExtensions } from 'codemirror-json-schema'
import { yamlCompletion, yamlSchemaHover, yamlSchemaLinter } from 'codemirror-json-schema/yaml'

export type ResourceYamlSchema = NonNullable<Parameters<typeof stateExtensions>[0]>

export function resourceYamlValidation(schema?: ResourceYamlSchema): Extension {
  if (!schema || !Object.keys(schema).length) return []
  const complete = yamlCompletion()
  const suggestions = (context: CompletionContext) => {
    if (context.state.readOnly) return null
    const result = complete(context)
    if ('options' in result && result.options.length) return result
    const line = context.state.doc.lineAt(context.pos), prefix = context.state.sliceDoc(line.from, context.pos)
    if (context.explicit && /^ *$/.test(prefix) && context.pos === line.to) {
      // An empty property establishes the cursor's map without inserting text into the view.
      const state = context.state.update({ changes: { from: context.pos, insert: '"": ' } }).state
      const emptyKey = complete(new CompletionContext(state, context.pos + 1, true))
      if ('options' in emptyKey && emptyKey.options.length) return { ...emptyKey, from: context.pos, to: context.pos }
    }
    const indent = /^ +(?=[\w-]*$)/.exec(prefix)?.[0]
    if (!indent || context.pos !== line.to) return null
    // The upstream library cannot infer an object from its first unfinished YAML key.
    // A transient parser context establishes that map; nothing is dispatched or saved.
    const placeholder = `${indent}__codemirror_completion__: null\n`
    const state = context.state.update({ changes: { from: line.from, insert: placeholder } }).state
    const fallback = complete(new CompletionContext(state, context.pos + placeholder.length, context.explicit))
    if (!('options' in fallback) || !fallback.options.length || fallback.from < line.from + placeholder.length) return null
    return { ...fallback, from: fallback.from - placeholder.length, to: fallback.to === undefined ? undefined : fallback.to - placeholder.length }
  }
  return [
    stateExtensions(schema),
    linter(yamlSchemaLinter(), { delay: 400, needsRefresh: handleRefresh }),
    yamlLanguage.data.of({ autocomplete: suggestions }),
    autocompletion({ closeOnBlur: false }), Prec.high(keymap.of(completionKeymap)),
    // Switching to an inherited or masked document must not leave insertion UI open.
    EditorView.updateListener.of(update => { if (update.state.readOnly && !update.startState.readOnly) queueMicrotask(() => closeCompletion(update.view)) }),
    hoverTooltip(yamlSchemaHover({ formatHover: ({ message, typeInfo }) => {
      const dom = document.createElement('div')
      dom.className = 'yaml-schema-hover'
      const description = document.createElement('div'), type = document.createElement('code')
      description.textContent = message; type.textContent = typeInfo
      dom.append(description, type)
      return dom
    } })),
  ]
}

