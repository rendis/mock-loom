import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { CodeEditor } from '../../shared/ui/code-editor'
import { Input } from '../../shared/ui/input'
import { Select } from '../../shared/ui/select'
import type { ScenarioDraft } from './scenario-model'

interface ScenarioResponseSectionProps {
  scenario: ScenarioDraft
  onStatusCodeChange: (value: string) => void
  onDelayMsChange: (value: string) => void
  onBodyJsonChange: (value: string) => void
  onHeadersModeChange: (mode: 'simple' | 'advanced') => void
  onHeadersJsonChange: (value: string) => void
  onHeaderChange: (headerId: string, field: 'key' | 'value', value: string) => void
  onAddHeader: () => void
  onRemoveHeader: (headerId: string) => void
  onApplyHeadersJsonToSimple: () => void
  onUseBodyTemplate: () => void
  onFormatBodyJson: () => void
}

export function ScenarioResponseSection({
  scenario,
  onStatusCodeChange,
  onDelayMsChange,
  onBodyJsonChange,
  onHeadersModeChange,
  onHeadersJsonChange,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
  onApplyHeadersJsonToSimple,
  onUseBodyTemplate,
  onFormatBodyJson,
}: ScenarioResponseSectionProps): JSX.Element {
  const { response } = scenario

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>RESPONSE</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onUseBodyTemplate}>
              Use common template
            </Button>
            <Button size="sm" variant="secondary" onClick={onFormatBodyJson}>
              Format JSON
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">statusCode</label>
            <Input value={response.statusCode} onChange={(event) => onStatusCodeChange(event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">delayMs</label>
            <Input value={response.delayMs} onChange={(event) => onDelayMsChange(event.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">headers</label>
            <Select
              value={response.headersMode}
              onChange={(event) => onHeadersModeChange(event.target.value === 'advanced' ? 'advanced' : 'simple')}
              className="h-8 w-[180px]"
            >
              <option value="simple">Simple key/value</option>
              <option value="advanced">Advanced JSON</option>
            </Select>
          </div>

          {response.headersMode === 'simple' ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface-soft p-3">
              {response.headers.map((header) => (
                <div key={header.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                  <Input
                    value={header.key}
                    placeholder="Header key"
                    onChange={(event) => onHeaderChange(header.id, 'key', event.target.value)}
                  />
                  <Input
                    value={header.value}
                    placeholder="Header value"
                    onChange={(event) => onHeaderChange(header.id, 'value', event.target.value)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => onRemoveHeader(header.id)} disabled={response.headers.length <= 1}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={onAddHeader}>
                Add header
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <CodeEditor
                language="json"
                value={response.headersJson}
                onChange={onHeadersJsonChange}
                height="160px"
                options={{
                  wordWrap: 'off',
                  minimap: { enabled: false },
                }}
              />
              <Button size="sm" variant="secondary" onClick={onApplyHeadersJsonToSimple}>
                Apply JSON to simple mode
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">body</label>
          <CodeEditor
            language="json"
            value={response.bodyJson}
            onChange={onBodyJsonChange}
            height="220px"
            options={{
              wordWrap: 'on',
              minimap: { enabled: false },
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
