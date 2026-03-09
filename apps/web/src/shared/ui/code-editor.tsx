import { useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

import { cn } from '../lib/cn'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: string
  height?: string
  className?: string
  readOnly?: boolean
  onMount?: OnMount
  options?: editor.IStandaloneEditorConstructionOptions
}

export function CodeEditor({
  value,
  onChange,
  language,
  height = '360px',
  className,
  readOnly = false,
  onMount,
  options,
}: CodeEditorProps): JSX.Element {
  const mergedOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontLigatures: false,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      formatOnPaste: true,
      formatOnType: true,
      // Keep suggest/hover widgets inside Monaco DOM tree so editor-scoped styles and
      // positioning remain stable while scrolling.
      fixedOverflowWidgets: false,
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'off',
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true,
      },
      suggest: {
        showWords: false,
      },
      quickSuggestionsDelay: 60,
      wordWrap: 'on',
      readOnly,
      padding: { top: 12, bottom: 12 },
      ...options,
    }),
    [options, readOnly]
  )

  return (
    <div className={cn('rounded-xl border border-border bg-surface-inset shadow-inset', className)}>
      <Editor
        height={height}
        language={language}
        options={mergedOptions}
        theme="mock-loom-v2"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        onMount={onMount}
      />
    </div>
  )
}
