import { ArrowDown, ArrowUp, Copy, Flag, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../shared/ui/button'
import { Badge } from '../../shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Tooltip } from '../../shared/ui/tooltip'
import type { ScenarioDiagnostic, ScenarioDraft } from './scenario-model'
import type { MouseEvent } from 'react'

interface ScenarioSidebarProps {
  drafts: ScenarioDraft[]
  diagnostics: ScenarioDiagnostic[]
  selectedScenarioId: string
  onSelect: (scenarioId: string) => void
  onAdd: () => void
  onDuplicate: (scenarioId: string) => void
  onDelete: (scenarioId: string) => void
  onMove: (scenarioId: string, direction: -1 | 1) => void
  onSetFallback: (scenarioId: string) => void
  onUnsetFallback: (scenarioId: string) => void
}

export function ScenarioSidebar({
  drafts,
  diagnostics,
  selectedScenarioId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onSetFallback,
  onUnsetFallback,
}: ScenarioSidebarProps): JSX.Element {
  const diagnosticsByScenario = buildDiagnosticsMap(diagnostics)

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Scenarios</CardTitle>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add scenario
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((scenario, index) => {
          const isSelected = selectedScenarioId === scenario.id
          const issueCount = diagnosticsByScenario.get(scenario.id) ?? 0

          return (
            <div
              key={scenario.id}
              className={`rounded-xl border p-3 ${isSelected ? 'border-primary bg-primary/10' : 'border-border bg-surface-soft'}`}
            >
              <button className="w-full text-left" onClick={() => onSelect(scenario.id)} type="button">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs font-semibold text-muted">
                    Priority {scenario.priority}
                  </span>
                  {scenario.fallback ? <Badge variant="warning">fallback</Badge> : <Badge variant="neutral">rule</Badge>}
                </div>
                <p className="truncate text-sm font-semibold text-text">{scenario.name}</p>
                <p className="mt-1 truncate text-xs font-mono text-muted">{scenario.fallback ? 'true' : scenario.whenExpr}</p>
                <p className="mt-1 text-xs text-muted">{issueCount > 0 ? `${issueCount} issues` : 'valid'}</p>
              </button>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ScenarioActionIconButton
                  label="Move up"
                  disabledLabel="Already first scenario"
                  disabled={index === 0}
                  onClick={(event) => handleActionClick(event, () => onMove(scenario.id, -1))}
                  icon={<ArrowUp className="h-4 w-4" aria-hidden />}
                />
                <ScenarioActionIconButton
                  label="Move down"
                  disabledLabel="Already last scenario"
                  disabled={index === drafts.length - 1}
                  onClick={(event) => handleActionClick(event, () => onMove(scenario.id, 1))}
                  icon={<ArrowDown className="h-4 w-4" aria-hidden />}
                />
                <ScenarioActionIconButton
                  label="Duplicate scenario"
                  onClick={(event) => handleActionClick(event, () => onDuplicate(scenario.id))}
                  icon={<Copy className="h-4 w-4" aria-hidden />}
                />
                <ScenarioActionIconButton
                  label={scenario.fallback ? 'Unset fallback' : 'Set as fallback'}
                  onClick={(event) => handleActionClick(event, () => (scenario.fallback ? onUnsetFallback(scenario.id) : onSetFallback(scenario.id)))}
                  icon={<Flag className="h-4 w-4" aria-hidden />}
                  active={scenario.fallback}
                />
                <ScenarioActionIconButton
                  label="Delete scenario"
                  onClick={(event) => handleActionClick(event, () => onDelete(scenario.id))}
                  destructive
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function buildDiagnosticsMap(diagnostics: ScenarioDiagnostic[]): Map<string, number> {
  const map = new Map<string, number>()
  diagnostics.forEach((item) => {
    const current = map.get(item.scenarioId) ?? 0
    map.set(item.scenarioId, current + 1)
  })
  return map
}

function handleActionClick(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
  event.preventDefault()
  event.stopPropagation()
  action()
}

interface ScenarioActionIconButtonProps {
  label: string
  icon: JSX.Element
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  disabledLabel?: string
  destructive?: boolean
  active?: boolean
}

function ScenarioActionIconButton({
  label,
  icon,
  onClick,
  disabled = false,
  disabledLabel,
  destructive = false,
  active = false,
}: ScenarioActionIconButtonProps): JSX.Element {
  return (
    <Tooltip content={disabled ? (disabledLabel ?? label) : label}>
      <span>
        <Button
          size="sm"
          variant="secondary"
          className={`h-8 w-8 rounded-lg p-0 shadow-tactile ${
            destructive
              ? 'text-muted hover:text-error'
              : active
                ? 'border-warning/40 bg-warning/10 text-warning-dark hover:bg-warning/20'
                : 'text-muted hover:text-primary-dark'
          }`}
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {icon}
        </Button>
      </span>
    </Tooltip>
  )
}
