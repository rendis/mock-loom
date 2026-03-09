import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEventHandler,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

import { cn } from '../lib/cn'

const EMPTY_VALUE_TOKEN = '__mock_loom_select_empty__'
const BODY_SELECT_OPEN_ATTRIBUTE = 'data-select-open'
const ROOT_SELECT_OPEN_ATTRIBUTE = 'data-select-open'

let openSelectCount = 0

function updateBodySelectOpenMarker(isOpen: boolean): void {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement

  if (isOpen) {
    openSelectCount += 1
    document.body.setAttribute(BODY_SELECT_OPEN_ATTRIBUTE, 'true')
    root.setAttribute(ROOT_SELECT_OPEN_ATTRIBUTE, 'true')
    return
  }

  openSelectCount = Math.max(0, openSelectCount - 1)
  if (openSelectCount === 0) {
    document.body.removeAttribute(BODY_SELECT_OPEN_ATTRIBUTE)
    root.removeAttribute(ROOT_SELECT_OPEN_ATTRIBUTE)
  }
}

interface ParsedSelectOption {
  disabled: boolean
  label: ReactNode
  value: string
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return ''
}

function encodeValue(value: string): string {
  return value === '' ? EMPTY_VALUE_TOKEN : value
}

function decodeValue(value: string): string {
  return value === EMPTY_VALUE_TOKEN ? '' : value
}

function parseOptions(children: ReactNode): ParsedSelectOption[] {
  const parsed: ParsedSelectOption[] = []

  const walk = (nodes: ReactNode): void => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) {
        return
      }

      if (child.type === Fragment) {
        walk(child.props.children)
        return
      }

      if (child.type !== 'option') {
        return
      }

      const value = toStringValue(child.props.value)
      parsed.push({
        value,
        label: child.props.children,
        disabled: Boolean(child.props.disabled),
      })
    })
  }

  walk(children)
  return parsed
}

export function Select({
  className,
  children,
  defaultValue,
  disabled,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  required,
  value,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  const options = useMemo(() => parseOptions(children), [children])
  const isControlled = value !== undefined
  const firstEnabledValue = options.find((option) => !option.disabled)?.value ?? ''
  const [isOpen, setIsOpen] = useState(false)
  const trackedOpenStateRef = useRef(false)

  const [internalValue, setInternalValue] = useState<string>(() => {
    if (defaultValue !== undefined) {
      return toStringValue(defaultValue)
    }
    return firstEnabledValue
  })

  const currentValue = isControlled ? toStringValue(value) : internalValue
  const hasCurrentOption = options.some((option) => option.value === currentValue)
  const effectiveValue = hasCurrentOption ? currentValue : (options[0]?.value ?? '')
  const selectedOption = options.find((option) => option.value === effectiveValue)
  const radixValue = options.length > 0 ? encodeValue(effectiveValue) : undefined
  const resolvedAriaLabel = props['aria-label'] ?? (name ? `Select ${name}` : 'Select option')

  const triggerLabel =
    selectedOption?.label ??
    (options.length > 0 ? (
      options[0]?.label
    ) : (
      <span className="text-muted">No options</span>
    ))

  const handleValueChange = (nextRadixValue: string): void => {
    const nextValue = decodeValue(nextRadixValue)
    if (!isControlled) {
      setInternalValue(nextValue)
    }
    if (!onChange) {
      return
    }
    const syntheticEvent = {
      target: { value: nextValue },
      currentTarget: { value: nextValue },
    } as ChangeEvent<HTMLSelectElement>
    onChange(syntheticEvent)
  }

  useEffect(() => {
    if (trackedOpenStateRef.current === isOpen) {
      return
    }

    trackedOpenStateRef.current = isOpen
    updateBodySelectOpenMarker(isOpen)
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (!trackedOpenStateRef.current) {
        return
      }
      trackedOpenStateRef.current = false
      updateBodySelectOpenMarker(false)
    }
  }, [])

  return (
    <RadixSelect.Root
      value={radixValue}
      onValueChange={handleValueChange}
      onOpenChange={setIsOpen}
      disabled={disabled}
      name={name}
      required={required}
    >
      <RadixSelect.Trigger
        aria-label={resolvedAriaLabel}
        aria-labelledby={props['aria-labelledby']}
        id={id}
        onBlur={onBlur as FocusEventHandler<HTMLButtonElement> | undefined}
        onFocus={onFocus as FocusEventHandler<HTMLButtonElement> | undefined}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-xl border border-border/90 bg-surface-inset px-3 text-left text-sm text-text shadow-inset transition-all outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-focus/25 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-focus/25',
          className
        )}
      >
        <RadixSelect.Value>{triggerLabel}</RadixSelect.Value>
        <RadixSelect.Icon className="ml-2 shrink-0 text-muted">
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal container={typeof document === 'undefined' ? undefined : document.body}>
        <RadixSelect.Content
          position="popper"
          align="start"
          sideOffset={6}
          collisionPadding={10}
          className="z-[220] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border/90 bg-surface-raised shadow-card"
        >
          <RadixSelect.Viewport className="max-h-72 p-1">
            {options.map((option, index) => (
              <RadixSelect.Item
                key={`${option.value}-${index}`}
                value={encodeValue(option.value)}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-text outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary-dark"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto text-primary">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
