import { useMemo, useState } from 'react'

import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import type { EndpointScenario } from '../../types/api'
import type { ScenarioDiagnostic } from './scenario-model'

type PreviewTab = 'compiled' | 'runtime' | 'issues'

interface ScenarioPreviewPanelProps {
  selectedScenarioId: string
  selectedScenarioName: string
  compiledScenario: EndpointScenario | null
  diagnostics: ScenarioDiagnostic[]
}

export function ScenarioPreviewPanel({
  selectedScenarioId,
  selectedScenarioName,
  compiledScenario,
  diagnostics,
}: ScenarioPreviewPanelProps): JSX.Element {
  const [tab, setTab] = useState<PreviewTab>('compiled')

  const selectedDiagnostics = useMemo(
    () => diagnostics.filter((item) => item.scenarioId === selectedScenarioId || item.scenarioId === 'global'),
    [diagnostics, selectedScenarioId]
  )

  return (
    <Card className="h-fit">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Preview & Diagnostics</CardTitle>
          <Badge variant={selectedDiagnostics.length > 0 ? 'error' : 'success'}>
            {selectedDiagnostics.length > 0 ? `${selectedDiagnostics.length} issues` : 'clean'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <button
            className={`rounded-md border px-2 py-1 text-xs ${tab === 'compiled' ? 'border-primary bg-primary/10 text-primary-dark' : 'border-border bg-surface-soft text-muted'}`}
            onClick={() => setTab('compiled')}
            type="button"
          >
            Compiled JSON
          </button>
          <button
            className={`rounded-md border px-2 py-1 text-xs ${tab === 'runtime' ? 'border-primary bg-primary/10 text-primary-dark' : 'border-border bg-surface-soft text-muted'}`}
            onClick={() => setTab('runtime')}
            type="button"
          >
            Runtime mapping
          </button>
          <button
            className={`rounded-md border px-2 py-1 text-xs ${tab === 'issues' ? 'border-primary bg-primary/10 text-primary-dark' : 'border-border bg-surface-soft text-muted'}`}
            onClick={() => setTab('issues')}
            type="button"
          >
            Issues
          </button>
        </div>

        {tab === 'compiled' ? (
          <pre className="max-h-[620px] overflow-auto rounded-xl border border-border bg-surface-soft p-3 text-xs">
            {compiledScenario ? JSON.stringify(compiledScenario, null, 2) : '{}'}
          </pre>
        ) : null}

        {tab === 'runtime' ? (
          <div className="space-y-2 rounded-xl border border-border bg-surface-soft p-3 text-xs">
            <p>
              <span className="font-semibold text-text">Scenario:</span> {selectedScenarioName}
            </p>
            <p>
              <span className="font-semibold text-text">conditionExpr:</span>{' '}
              <span className="font-mono">{compiledScenario?.conditionExpr ?? 'true'}</span>
            </p>
            <p>
              <span className="font-semibold text-text">response:</span> status {compiledScenario?.response.statusCode ?? 200}, delay{' '}
              {compiledScenario?.response.delayMs ?? 0}ms
            </p>
            <p>
              <span className="font-semibold text-text">mutations:</span> {(compiledScenario?.mutations ?? []).length}
            </p>
            <p className="text-muted">
              Runtime Go evaluates <code className="font-mono">conditionExpr</code> with expr and applies response/mutations for first matched scenario by
              priority.
            </p>
          </div>
        ) : null}

        {tab === 'issues' ? (
          selectedDiagnostics.length > 0 ? (
            <Alert tone="error">
              <div className="space-y-1">
                {selectedDiagnostics.map((item, index) => (
                  <p key={`${item.code}-${item.field}-${index}`} className="text-xs">
                    [{item.field}] {item.message}
                  </p>
                ))}
              </div>
            </Alert>
          ) : (
            <Alert tone="success">No blocking issues for selected scenario.</Alert>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}
