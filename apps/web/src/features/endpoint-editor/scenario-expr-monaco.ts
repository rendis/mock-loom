import type { IDisposable } from 'monaco-editor'
import type * as Monaco from 'monaco-editor'

import type { EndpointCompletionProvider } from './completion-provider'
import { routeExprCompletion } from './expr-assist-v2/context-router'

const LANGUAGE_ID = 'mockloom-expr'
let languageRegistered = false

const FUNCTION_DOCS: Record<string, string> = {
  contains: 'contains operator for substring matching in expr conditions.',
  startsWith: 'startsWith operator for prefix matching in expr conditions.',
  endsWith: 'endsWith operator for suffix matching in expr conditions.',
}

export function registerScenarioExprAssist(
  monaco: typeof Monaco,
  provider: EndpointCompletionProvider
): IDisposable[] {
  ensureExprLanguage(monaco)

  const completionDisposable = monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['.', '[', '(', '"', "'"],
    provideCompletionItems(model, position, context) {
      const line = model.getLineContent(position.lineNumber)
      const prefix = line.slice(0, Math.max(0, position.column - 1))
      const invokedManually = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke
      const route = routeExprCompletion({
        prefix,
        invokedManually,
        isKnownLeafPath: provider.isKnownLeafPath,
        canonicalizePath: provider.canonicalizePath,
      })

      const range = buildRange(position, route.replaceStartIndex, route.replaceEndIndex)
      let suggestions: Monaco.languages.CompletionItem[] = []

      switch (route.state) {
        case 'ROOT': {
          suggestions = mapRootSuggestions(monaco, provider, range, route.query)
          break
        }
        case 'REQUEST_PARAM_ALIAS': {
          suggestions = provider.requestParamSuggestions(route.query, 80).map((item, index) => ({
              label: `${item.key} [${item.scope}]`,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: item.canonicalPath,
              detail: `${item.scope} • ${item.canonicalPath}`,
              documentation: {
                value: `Insert canonical runtime path: \`${item.canonicalPath}\``,
              },
              sortText: `0_alias_${index.toString().padStart(4, '0')}`,
              range,
            }))
          break
        }
        case 'REQUEST_SCOPE': {
          if (!route.scope) {
            break
          }
          suggestions = provider.requestScopeSuggestions(route.scope, route.query, 80).map((item, index) => ({
              label: `${item.key} [${item.scope}]`,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: route.query !== '' || route.hasTrailingDot ? item.key : `.${item.key}`,
              detail: `${item.scope} • ${item.canonicalPath}`,
              sortText: `0_request_scope_${index.toString().padStart(4, '0')}`,
              range,
            }))
          break
        }
        case 'SOURCE_ROOT': {
          suggestions = mapSourceRootSuggestions(monaco, provider, range, route.query, route.token)
          break
        }
        case 'SOURCE_SLUG': {
          if (!route.slug) {
            break
          }
          suggestions = provider.sourceFieldSuggestions(route.slug, route.query, 80).map((field, index) => ({
              label: field,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: route.query !== '' || route.hasTrailingDot ? field : `.${field}`,
              detail: `Field from source.${route.slug}`,
              sortText: `0_source_field_${index.toString().padStart(4, '0')}`,
              range,
            }))
          break
        }
        case 'LEAF_VALUE': {
          if (!route.targetPath) {
            break
          }
          const operators = provider.leafOperatorSuggestions(route.targetPath, route.hasTrailingDot)
          suggestions = operators.map((item, index) => ({
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: item.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: item.detail,
              sortText: `${item.sortRank}_${index.toString().padStart(4, '0')}`,
              range,
            }))
          break
        }
        case 'UNKNOWN':
        default:
          suggestions = []
          break
      }

      if (suggestions.length === 0) {
        const contextualFallback = buildContextualEmptySuggestion(monaco, route, range)
        if (contextualFallback) {
          return { suggestions: [contextualFallback] }
        }

        if (shouldFallbackToRoot(route.state, invokedManually)) {
          const rootSuggestions = mapRootSuggestions(monaco, provider, range, '')
          if (rootSuggestions.length > 0) {
            return {
              suggestions: rootSuggestions,
            }
          }
          return {
            suggestions: [
              {
                label: 'No suggestions available',
                kind: monaco.languages.CompletionItemKind.Text,
                insertText: '',
                detail: 'Runtime completion context is currently empty',
                sortText: '9_empty',
                range,
              },
            ],
          }
        }
      }

      return { suggestions }
    },
  })

  const hoverDisposable = monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) {
        return null
      }
      const documentation = FUNCTION_DOCS[word.word]
      if (!documentation) {
        return null
      }
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [{ value: `**${word.word}**` }, { value: documentation }],
      }
    },
  })

  return [completionDisposable, hoverDisposable]
}

function ensureExprLanguage(monaco: typeof Monaco): void {
  if (languageRegistered) {
    return
  }

  monaco.languages.register({ id: LANGUAGE_ID })

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\b(true|false|nil|in)\b/, 'keyword'],
        [/\b(request|source|auth)\b/, 'type.identifier'],
        [/\b(contains|startsWith|endsWith)\b/, 'predefined'],
        [/[a-zA-Z_][\w$]*/, 'identifier'],
        [/\d+/, 'number'],
        [/[=><!~?:&|+\-*/^%]+/, 'operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '//' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
  })

  languageRegistered = true
}

function buildRange(position: Monaco.Position, replaceStartIndex: number, replaceEndIndex: number): Monaco.IRange {
  const startColumn = Math.max(1, replaceStartIndex + 1)
  const endColumn = Math.max(startColumn, replaceEndIndex + 1)
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn,
    endColumn,
  }
}

function mapRootSuggestions(
  monaco: typeof Monaco,
  provider: EndpointCompletionProvider,
  range: Monaco.IRange,
  query: string
): Monaco.languages.CompletionItem[] {
  return provider.rootSuggestions(query, 20).map((item, index) => ({
    label: item.label,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: item.insertText,
    detail: item.detail,
    sortText: `0_root_${index.toString().padStart(4, '0')}`,
    range,
  }))
}

function mapSourceRootSuggestions(
  monaco: typeof Monaco,
  provider: EndpointCompletionProvider,
  range: Monaco.IRange,
  query: string,
  token: string
): Monaco.languages.CompletionItem[] {
  const availableSlugs = provider.sourceSlugs()
  if (availableSlugs.length === 0) {
    return [
      {
        label: 'No active sources',
        kind: monaco.languages.CompletionItemKind.Text,
        insertText: '',
        detail: 'source. is available but there are no active runtime sources',
        sortText: '9_source_empty',
        range,
      },
    ]
  }

  const sourceSlugs = provider.sourceSlugSuggestions(query, 60)
  if (sourceSlugs.length > 0) {
    return sourceSlugs.map((slug, index) => ({
      label: slug,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: token === 'source' ? `source.${slug}.` : `${slug}.`,
      detail: `Runtime source slug: ${slug}`,
      sortText: `0_source_root_${index.toString().padStart(4, '0')}`,
      range,
    }))
  }

  return []
}

function shouldFallbackToRoot(state: string, invokedManually: boolean): boolean {
  if (state === 'ROOT') {
    return true
  }
  return invokedManually && state === 'UNKNOWN'
}

function buildContextualEmptySuggestion(
  monaco: typeof Monaco,
  route: ReturnType<typeof routeExprCompletion>,
  range: Monaco.IRange
): Monaco.languages.CompletionItem | null {
  switch (route.state) {
    case 'REQUEST_SCOPE': {
      const scopeLabel = route.scope ?? 'request'
      return {
        label: `No ${scopeLabel} params available`,
        kind: monaco.languages.CompletionItemKind.Text,
        insertText: '',
        detail: `No ${scopeLabel} params were discovered for this endpoint.`,
        sortText: '9_empty_context',
        range,
      }
    }
    case 'REQUEST_PARAM_ALIAS':
      return {
        label: 'No request params available',
        kind: monaco.languages.CompletionItemKind.Text,
        insertText: '',
        detail: 'request.param.* has no available keys in the current endpoint context.',
        sortText: '9_empty_context',
        range,
      }
    case 'SOURCE_SLUG': {
      const slugLabel = route.slug ? `source.${route.slug}` : 'source'
      return {
        label: `No fields available in ${slugLabel}`,
        kind: monaco.languages.CompletionItemKind.Text,
        insertText: '',
        detail: `${slugLabel} has no discoverable fields in runtime context.`,
        sortText: '9_empty_context',
        range,
      }
    }
    default:
      return null
  }
}

export function scenarioExprLanguageID(): string {
  return LANGUAGE_ID
}

export const scenarioExprMonacoInternals = {
  routeExprCompletion,
  shouldFallbackToRoot,
}
