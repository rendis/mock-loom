import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'

import {
  createPathTextToken,
  finalizePathParamName,
  insertEmptyPathParamAtCursor,
  mergeAdjacentTextTokens,
  normalizeAdjacentPathParamTokens,
  normalizePathParamName,
  serializePathTemplate,
  tokenizePathTemplate,
  type PathTemplateParamToken,
  type PathTemplateTextToken,
  type PathTemplateToken,
} from './path-template'
import { cn } from '../../shared/lib/cn'
import { Tooltip } from '../../shared/ui/tooltip'

interface PathTemplateInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  ariaLabel?: string
}

export function PathTemplateInput({
  value,
  onChange,
  placeholder = '/resource/{id}',
  disabled = false,
  autoFocus = false,
  className,
  ariaLabel = 'Path template',
}: PathTemplateInputProps): JSX.Element {
  const [tokens, setTokens] = useState<PathTemplateToken[]>(() => toEditableTokens(tokenizePathTemplate(value)))
  const [selectedParamID, setSelectedParamID] = useState('')
  const [editingParamID, setEditingParamID] = useState('')
  const tokensRef = useRef<PathTemplateToken[]>(tokens)
  const textInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const paramInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const chipRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const lastCommittedValueRef = useRef(value)
  const pendingFocusParamIDRef = useRef('')
  const skipBlurFinalizeParamIDRef = useRef('')
  const didAutoFocusRef = useRef(false)

  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  useEffect(() => {
    if (value === lastCommittedValueRef.current) {
      return
    }
    const parsed = toEditableTokens(normalizeAdjacentPathParamTokens(tokenizePathTemplate(value)))
    const paramIDs = new Set(parsed.filter((token): token is PathTemplateParamToken => token.type === 'param').map((token) => token.id))

    tokensRef.current = parsed
    setTokens(parsed)
    setSelectedParamID((current) => (paramIDs.has(current) ? current : ''))
    setEditingParamID((current) => (paramIDs.has(current) ? current : ''))
    lastCommittedValueRef.current = value
  }, [value])

  useEffect(() => {
    const targetParamID = pendingFocusParamIDRef.current || editingParamID
    if (targetParamID === '') {
      return
    }

    const input = paramInputRefs.current.get(targetParamID)
    if (!input) {
      return
    }

    input.focus()
    const cursorPosition = input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
    pendingFocusParamIDRef.current = ''
  }, [tokens, editingParamID])

  useEffect(() => {
    if (!autoFocus || didAutoFocusRef.current || disabled) {
      return
    }
    const firstText = tokens.find((token): token is PathTemplateTextToken => token.type === 'text')
    if (!firstText) {
      return
    }
    const input = textInputRefs.current.get(firstText.id)
    if (!input) {
      return
    }
    input.focus()
    const cursorPosition = input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
    didAutoFocusRef.current = true
  }, [autoFocus, disabled, tokens])

  function commitTokens(nextTokens: PathTemplateToken[]): void {
    const editableTokens = toEditableTokens(nextTokens)
    const withSeparators = normalizeAdjacentPathParamTokens(editableTokens)
    const normalized = toEditableTokens(withSeparators)
    const serialized = serializePathTemplate(normalized)
    const paramIDs = new Set(normalized.filter((token): token is PathTemplateParamToken => token.type === 'param').map((token) => token.id))

    tokensRef.current = normalized
    setTokens(normalized)
    setSelectedParamID((current) => (current !== '' && !paramIDs.has(current) ? '' : current))
    setEditingParamID((current) => (current !== '' && !paramIDs.has(current) ? '' : current))
    lastCommittedValueRef.current = serialized
    onChange(serialized)
  }

  function focusTextToken(tokenID: string, position: 'start' | 'end'): void {
    const input = textInputRefs.current.get(tokenID)
    if (!input) {
      return
    }

    input.focus()
    const cursorPosition = position === 'start' ? 0 : input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
    setSelectedParamID('')
    setEditingParamID('')
  }

  function focusChipView(paramID: string): void {
    const chip = chipRefs.current.get(paramID)
    setSelectedParamID(paramID)
    setEditingParamID('')
    chip?.focus()
  }

  function focusLastTextTokenAtEnd(): void {
    for (let index = tokensRef.current.length - 1; index >= 0; index -= 1) {
      const token = tokensRef.current[index]
      if (token?.type === 'text') {
        focusTextToken(token.id, 'end')
        return
      }
    }
  }

  function startChipEditing(paramID: string): void {
    if (disabled) {
      return
    }
    pendingFocusParamIDRef.current = paramID
    setSelectedParamID(paramID)
    setEditingParamID(paramID)
  }

  function updateTextToken(tokenID: string, nextValue: string): void {
    const currentTokens = tokensRef.current
    const tokenIndex = currentTokens.findIndex((token) => token.id === tokenID && token.type === 'text')
    if (tokenIndex < 0) {
      return
    }

    // Keep the same text token identity during normal typing so focus/caret don't jump.
    // Param creation via ":" is handled in keydown to avoid remounting on every keystroke.
    if (!/[{}]/.test(nextValue)) {
      const nextTokens = currentTokens.map((token) => {
        if (token.type !== 'text' || token.id !== tokenID) {
          return token
        }
        return {
          ...token,
          value: nextValue,
        }
      })
      commitTokens(nextTokens)
      return
    }

    const replacement = tokenizePathTemplate(nextValue)
    const nextTokens = replaceTokenAt(currentTokens, tokenIndex, replacement.length === 0 ? [createPathTextToken('')] : replacement)
    commitTokens(nextTokens)
  }

  function updateParamToken(tokenID: string, nextName: string): void {
    const nextTokens = tokensRef.current.map((token) => {
      if (token.type !== 'param' || token.id !== tokenID) {
        return token
      }
      return {
        ...token,
        name: normalizePathParamName(nextName),
      }
    })
    commitTokens(nextTokens)
  }

  function finalizeParamToken(tokenID: string): void {
    const nextTokens = tokensRef.current.map((token) => {
      if (token.type !== 'param' || token.id !== tokenID) {
        return token
      }
      return {
        ...token,
        name: finalizePathParamName(token.name),
      }
    })
    commitTokens(nextTokens)
  }

  function finalizeEditing(tokenID: string): void {
    finalizeParamToken(tokenID)
    setEditingParamID((current) => (current === tokenID ? '' : current))
  }

  function moveFromChip(tokenID: string, direction: 'left' | 'right'): void {
    const currentTokens = tokensRef.current
    const tokenIndex = currentTokens.findIndex((token) => token.type === 'param' && token.id === tokenID)
    if (tokenIndex < 0) {
      return
    }

    const targetIndex = direction === 'right' ? tokenIndex + 1 : tokenIndex - 1
    const target = currentTokens[targetIndex]
    if (!target) {
      return
    }

    if (target.type === 'param') {
      focusChipView(target.id)
      return
    }

    focusTextToken(target.id, direction === 'right' ? 'start' : 'end')
  }

  function insertEmptyParamFromKey(tokenID: string, event: KeyboardEvent<HTMLInputElement>): boolean {
    if (disabled || (event.key !== '{' && event.key !== ':')) {
      return false
    }

    const currentTokens = tokensRef.current
    const tokenIndex = currentTokens.findIndex((token) => token.id === tokenID && token.type === 'text')
    if (tokenIndex < 0) {
      return false
    }
    const token = currentTokens[tokenIndex] as PathTemplateTextToken
    const cursorStart = event.currentTarget.selectionStart ?? token.value.length
    const cursorEnd = event.currentTarget.selectionEnd ?? cursorStart
    const mergedText = `${token.value.slice(0, cursorStart)}${token.value.slice(cursorEnd)}`

    if (event.key === ':' && !canStartPathParamFromColon(mergedText, cursorStart)) {
      return false
    }

    event.preventDefault()
    const withParam = insertEmptyPathParamAtCursor(mergedText, cursorStart)
    const replacement = tokenizePathTemplate(withParam)
    const insertedParam = replacement.find((item): item is PathTemplateParamToken => item.type === 'param')?.id ?? ''

    const nextTokens = replaceTokenAt(currentTokens, tokenIndex, replacement)
    commitTokens(nextTokens)
    if (insertedParam !== '') {
      startChipEditing(insertedParam)
    }
    return true
  }

  function handleTextKeyDown(tokenID: string, event: KeyboardEvent<HTMLInputElement>): void {
    if (insertEmptyParamFromKey(tokenID, event)) {
      return
    }

    if (disabled || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) {
      return
    }

    const currentTokens = tokensRef.current
    const tokenIndex = currentTokens.findIndex((token) => token.id === tokenID && token.type === 'text')
    if (tokenIndex < 0) {
      return
    }

    const selectionStart = event.currentTarget.selectionStart ?? 0
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart
    const hasSelection = selectionStart !== selectionEnd
    if (hasSelection) {
      return
    }

    if (event.key === 'ArrowRight' && selectionStart === event.currentTarget.value.length) {
      const nextToken = currentTokens[tokenIndex + 1]
      if (nextToken?.type === 'param') {
        event.preventDefault()
        focusChipView(nextToken.id)
      }
      return
    }

    if (event.key === 'ArrowLeft' && selectionStart === 0) {
      const previousToken = currentTokens[tokenIndex - 1]
      if (previousToken?.type === 'param') {
        event.preventDefault()
        focusChipView(previousToken.id)
      }
    }
  }

  function handleTextPaste(tokenID: string, event: ClipboardEvent<HTMLInputElement>): void {
    if (disabled) {
      return
    }
    const pasted = event.clipboardData.getData('text')
    if (!/[{}:]/.test(pasted)) {
      return
    }
    event.preventDefault()

    const currentTokens = tokensRef.current
    const tokenIndex = currentTokens.findIndex((token) => token.id === tokenID && token.type === 'text')
    if (tokenIndex < 0) {
      return
    }
    const token = currentTokens[tokenIndex] as PathTemplateTextToken
    const start = event.currentTarget.selectionStart ?? token.value.length
    const end = event.currentTarget.selectionEnd ?? start
    const mergedText = `${token.value.slice(0, start)}${pasted}${token.value.slice(end)}`
    const replacement = tokenizePathTemplate(mergedText)
    const firstParam = replacement.find((item): item is PathTemplateParamToken => item.type === 'param')?.id ?? ''
    const nextTokens = replaceTokenAt(currentTokens, tokenIndex, replacement)
    commitTokens(nextTokens)
    if (firstParam !== '') {
      startChipEditing(firstParam)
    }
  }

  function removeParamToken(tokenID: string): void {
    const nextTokens = tokensRef.current.filter((token) => token.id !== tokenID)
    commitTokens(nextTokens)
    setSelectedParamID((current) => (current === tokenID ? '' : current))
    setEditingParamID((current) => (current === tokenID ? '' : current))
  }

  function handleChipViewKeyDown(tokenID: string, event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || editingParamID === tokenID) {
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeParamToken(tokenID)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      startChipEditing(tokenID)
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      moveFromChip(tokenID, event.key === 'ArrowRight' ? 'right' : 'left')
    }
  }

  function handleChipEditKeyDown(tokenID: string, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      skipBlurFinalizeParamIDRef.current = tokenID
      finalizeEditing(tokenID)
      setTimeout(() => {
        focusChipView(tokenID)
      }, 0)
      return
    }

    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return
    }

    const selectionStart = event.currentTarget.selectionStart ?? 0
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart
    const hasSelection = selectionStart !== selectionEnd
    if (hasSelection) {
      return
    }

    const isAtRightEdge = event.key === 'ArrowRight' && selectionStart === event.currentTarget.value.length
    const isAtLeftEdge = event.key === 'ArrowLeft' && selectionStart === 0
    if (!isAtRightEdge && !isAtLeftEdge) {
      return
    }

    event.preventDefault()
    skipBlurFinalizeParamIDRef.current = tokenID
    finalizeEditing(tokenID)
    setTimeout(() => {
      moveFromChip(tokenID, isAtRightEdge ? 'right' : 'left')
    }, 0)
  }

  function handleChipInputBlur(tokenID: string): void {
    if (skipBlurFinalizeParamIDRef.current === tokenID) {
      skipBlurFinalizeParamIDRef.current = ''
      return
    }
    finalizeEditing(tokenID)
  }

  function handleContainerMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (disabled || event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement
    if (target.closest('input, button, [data-path-chip]')) {
      return
    }

    event.preventDefault()
    focusLastTextTokenAtEnd()
  }

  return (
    <div
      className={cn(
        'flex min-h-10 w-full flex-wrap items-center gap-0 rounded-xl border border-border/90 bg-surface-inset px-2 py-1 shadow-inset transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-focus/25',
        className
      )}
      aria-label={ariaLabel}
      onMouseDown={handleContainerMouseDown}
    >
      {tokens.map((token, index) => {
        if (token.type === 'text') {
          const hasAnyParam = tokens.some((item) => item.type === 'param')
          const isSingleTextToken = tokens.length === 1
          const hasParamAfter = tokens[index + 1]?.type === 'param'
          const compactTextSize = Math.max(1, token.value.length + (hasParamAfter ? 0 : 1))
          return (
            <input
              key={token.id}
              ref={(node) => {
                if (node) {
                  textInputRefs.current.set(token.id, node)
                  return
                }
                textInputRefs.current.delete(token.id)
              }}
              type="text"
              className={cn(
                'bg-transparent py-1 font-mono text-sm text-text placeholder:text-muted focus:outline-none',
                !hasAnyParam && isSingleTextToken ? 'min-w-[2ch] flex-1 px-1' : 'w-auto min-w-[1ch] flex-none px-0'
              )}
              placeholder={index === 0 && !hasAnyParam ? placeholder : ''}
              value={token.value}
              size={!hasAnyParam && isSingleTextToken ? undefined : compactTextSize}
              disabled={disabled}
              aria-label={index === 0 ? ariaLabel : undefined}
              onChange={(event) => updateTextToken(token.id, event.target.value)}
              onKeyDown={(event) => handleTextKeyDown(token.id, event)}
              onPaste={(event) => handleTextPaste(token.id, event)}
            />
          )
        }

        const isSelected = selectedParamID === token.id
        const isEditing = editingParamID === token.id

        return (
          <div
            key={token.id}
            ref={(node) => {
              if (node) {
                chipRefs.current.set(token.id, node)
                return
              }
              chipRefs.current.delete(token.id)
            }}
            data-path-chip
            role="button"
            tabIndex={disabled || isEditing ? -1 : 0}
            aria-label={token.name === '' ? 'Empty path parameter chip' : `Path parameter chip ${token.name}`}
            className={cn(
              'relative mx-1 inline-flex max-w-[16rem] items-center gap-1 py-1 font-mono outline-none transition-all',
              isEditing
                ? 'text-primary-dark'
                : 'text-primary-dark/90',
              isSelected && !isEditing ? 'rounded-sm bg-primary/10' : undefined
            )}
            onClick={() => startChipEditing(token.id)}
            onFocus={() => {
              setSelectedParamID(token.id)
              if (!isEditing) {
                setEditingParamID('')
              }
            }}
            onKeyDown={(event) => handleChipViewKeyDown(token.id, event)}
          >
            {isEditing ? (
              <>
                <span className="text-sm font-semibold text-primary-dark/85">:</span>
                <input
                  ref={(node) => {
                    if (node) {
                      paramInputRefs.current.set(token.id, node)
                      return
                    }
                    paramInputRefs.current.delete(token.id)
                  }}
                  type="text"
                  className="min-w-[3ch] max-w-[12ch] border-0 border-b border-dashed border-primary/55 bg-transparent p-0 text-sm font-semibold leading-none outline-none"
                  value={token.name}
                  disabled={disabled}
                  placeholder="param"
                  aria-label="Path parameter name"
                  onChange={(event) => updateParamToken(token.id, event.target.value)}
                  onKeyDown={(event) => handleChipEditKeyDown(token.id, event)}
                  onBlur={() => handleChipInputBlur(token.id)}
                />
              </>
            ) : (
              <ChipLabelWithOverflowTooltip value={token.name} />
            )}
            <Tooltip
              content="Remove path parameter chip"
              className="inline-flex"
            >
              <button
                type="button"
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted transition-colors hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Remove path parameter chip"
                disabled={disabled}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  removeParamToken(token.id)
                }}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

function toEditableTokens(tokens: PathTemplateToken[]): PathTemplateToken[] {
  const merged = mergeAdjacentTextTokens(tokens)
  if (merged.length === 0) {
    return [createPathTextToken('')]
  }

  const next: PathTemplateToken[] = []
  merged.forEach((token, index) => {
    if (token.type === 'text') {
      next.push(token)
      return
    }

    if (next.length === 0 || next[next.length - 1]?.type !== 'text') {
      next.push(createPathTextToken(''))
    }
    next.push(token)

    const following = merged[index + 1]
    if (!following || following.type !== 'text') {
      next.push(createPathTextToken(''))
    }
  })

  return mergeAdjacentTextTokens(next)
}

function replaceTokenAt(tokens: PathTemplateToken[], tokenIndex: number, replacement: PathTemplateToken[]): PathTemplateToken[] {
  return [...tokens.slice(0, tokenIndex), ...replacement, ...tokens.slice(tokenIndex + 1)]
}

function canStartPathParamFromColon(value: string, cursor: number): boolean {
  if (cursor < 0 || cursor > value.length) {
    return false
  }
  if (cursor === 0) {
    return true
  }
  return value[cursor - 1] === '/'
}

function ChipLabelWithOverflowTooltip({ value }: { value: string }): JSX.Element {
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const [isTruncated, setIsTruncated] = useState(false)
  const label = value === '' ? ':param' : `:${value}`

  useEffect(() => {
    const element = labelRef.current
    if (!element) {
      setIsTruncated(false)
      return
    }

    const checkTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth + 1)
    }

    checkTruncation()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        checkTruncation()
      })
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', checkTruncation)
    return () => window.removeEventListener('resize', checkTruncation)
  }, [label])

  const content = (
    <span
      ref={labelRef}
      className={cn(
        'inline-block max-w-[12ch] truncate text-sm font-semibold leading-none',
        value === ''
          ? 'text-muted italic underline decoration-dashed underline-offset-4'
          : 'text-primary-dark underline decoration-primary/50 decoration-dashed underline-offset-4'
      )}
    >
      {label}
    </span>
  )

  if (!isTruncated) {
    return content
  }

  return (
    <Tooltip content={label} className="w-full min-w-0" contentClassName="max-w-[280px] break-all">
      {content}
    </Tooltip>
  )
}
