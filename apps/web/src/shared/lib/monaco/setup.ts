import * as monaco from 'monaco-editor'

import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

let initialized = false

export function setupMonacoEnvironment(): void {
  if (initialized || typeof window === 'undefined') {
    return
  }

  ;(self as {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker
    }
  }).MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') {
        return new jsonWorker()
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }

  monaco.editor.defineTheme('mock-loom-v2', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '2E55B8', fontStyle: 'bold' },
      { token: 'string', foreground: '116149' },
      { token: 'number', foreground: 'A2410A' },
      { token: 'comment', foreground: '64707D' },
      { token: 'identifier', foreground: '162038' },
      { token: 'operator', foreground: '3A3F4A' },
      { token: 'delimiter', foreground: '3A3F4A' },
    ],
    colors: {
      'editor.background': '#E9EDF4',
      'editor.foreground': '#162038',
      'editorLineNumber.foreground': '#64707D',
      'editorLineNumber.activeForeground': '#24324C',
      'editorCursor.foreground': '#4351B0',
      'editor.selectionBackground': '#C9D8FF',
      'editor.inactiveSelectionBackground': '#DCE5FB',
      'editorIndentGuide.background1': '#CFD6E6',
      'editorWhitespace.foreground': '#CFD6E6',
      'editorGutter.background': '#EEF2F8',
      'editorLineHighlightBackground': '#F4F7FC',
      'editorBracketMatch.background': '#DCE5FB',
      'editorBracketMatch.border': '#95A7D8',
      'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#D6DFEC',
      'input.background': '#EEF2F8',
      'input.border': '#D6DFEC',
      'input.foreground': '#162038',
      'input.placeholderForeground': '#64707D',
      'list.hoverBackground': '#EEF2F8',
      'list.activeSelectionBackground': '#DCE5FB',
      'list.activeSelectionForeground': '#162038',
      'list.inactiveSelectionBackground': '#E7ECF8',
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.border': '#D6DFEC',
      'editorSuggestWidget.foreground': '#162038',
      'editorSuggestWidget.selectedBackground': '#EEF2F8',
      'editorHoverWidget.background': '#FFFFFF',
      'editorHoverWidget.border': '#D6DFEC',
    },
  })

  initialized = true
}
