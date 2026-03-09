import type { OnMount } from '@monaco-editor/react'

import { Badge } from '../../shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { Button } from '../../shared/ui/button'
import { CodeEditor } from '../../shared/ui/code-editor'
import type { EndpointCompletionProvider } from './completion-provider'
import { scenarioExprLanguageID } from './scenario-expr-monaco'
import type { ScenarioDraft } from './scenario-model'

interface ScenarioWhenSectionProps {
  scenario: ScenarioDraft
  completionProvider: EndpointCompletionProvider
  onChange: (value: string) => void
  onMount?: OnMount
}

const QUICK_INSERTS = [
  { label: 'contains', template: 'request.params.body.email contains "@acme.com"' },
  { label: 'startsWith', template: 'request.path startsWith "/api/v1"' },
  { label: 'endsWith', template: 'request.params.body.email endsWith ".com"' },
  { label: 'x in [a,b]', template: 'request.params.path.role in ["admin", "editor"]' },
  { label: '== true', template: 'request.params.body.active == true' },
  { label: '== false', template: 'request.params.body.active == false' },
]

export function ScenarioWhenSection({ scenario, completionProvider, onChange, onMount }: ScenarioWhenSectionProps): JSX.Element {
  const sourceSlug = completionProvider.sourceSlugs()[0] ?? ''

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>WHEN</CardTitle>
          {scenario.fallback ? <Badge variant="warning">Fallback fixed to true</Badge> : <Badge variant="info">Expr mode</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <CodeEditor
          language={scenarioExprLanguageID()}
          value={scenario.fallback ? 'true' : scenario.whenExpr}
          onChange={(value) => onChange(value)}
          onMount={onMount}
          readOnly={scenario.fallback}
          height="180px"
          options={{
            lineNumbers: 'on',
            wordWrap: 'on',
            minimap: { enabled: false },
            wordBasedSuggestions: 'off',
          }}
        />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Quick insert</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_INSERTS.map((item) => (
              <Button
                key={item.label}
                size="sm"
                variant="secondary"
                onClick={() => onChange(composeExprAppend(scenario.whenExpr, item.template))}
                disabled={scenario.fallback}
              >
                {item.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChange(composeExprAppend(scenario.whenExpr, `source.${sourceSlug}_by_id[request.params.path.id] != nil`))}
              disabled={scenario.fallback || sourceSlug === ''}
            >
              source.&lt;slug&gt;_by_id
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function composeExprAppend(current: string, template: string): string {
  const trimmed = current.trim()
  if (trimmed === '' || trimmed === 'true') {
    return template
  }
  return `${trimmed}\n&& ${template}`
}
