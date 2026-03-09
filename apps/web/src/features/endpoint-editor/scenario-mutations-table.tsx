import { Trash2 } from 'lucide-react'
import type { OnMount } from '@monaco-editor/react'

import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { CodeEditor } from '../../shared/ui/code-editor'
import { Select } from '../../shared/ui/select'
import { Tooltip } from '../../shared/ui/tooltip'
import { scenarioExprLanguageID } from './scenario-expr-monaco'
import type { ScenarioDraft, ScenarioMutationDraftType } from './scenario-model'

interface ScenarioMutationsTableProps {
  scenario: ScenarioDraft
  sourceSlugs: string[]
  onAddMutation: () => void
  onRemoveMutation: (mutationId: string) => void
  onMutationTypeChange: (mutationId: string, value: ScenarioMutationDraftType) => void
  onMutationSourceSlugChange: (mutationId: string, value: string) => void
  onMutationEntityExprChange: (mutationId: string, value: string) => void
  onMutationPayloadExprChange: (mutationId: string, value: string) => void
  onExprMount?: OnMount
}

export function ScenarioMutationsTable({
  scenario,
  sourceSlugs,
  onAddMutation,
  onRemoveMutation,
  onMutationTypeChange,
  onMutationSourceSlugChange,
  onMutationEntityExprChange,
  onMutationPayloadExprChange,
  onExprMount,
}: ScenarioMutationsTableProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>MUTATIONS</CardTitle>
          <Button size="sm" variant="secondary" onClick={onAddMutation}>
            Add mutation
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {scenario.mutations.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface-soft p-3 text-sm text-muted">
            No mutations configured for this scenario.
          </div>
        ) : null}

        {scenario.mutations.map((mutation) => (
          <div key={mutation.id} className="rounded-xl border border-border bg-surface-soft p-3">
            <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-[150px_minmax(0,1fr)_auto]">
              <Select
                value={mutation.type}
                onChange={(event) => onMutationTypeChange(mutation.id, event.target.value === 'delete' ? 'delete' : 'update')}
              >
                <option value="update">update (UPSERT)</option>
                <option value="delete">delete (DELETE)</option>
              </Select>
              <Select value={mutation.sourceSlug} onChange={(event) => onMutationSourceSlugChange(mutation.id, event.target.value)}>
                <option value="">Select source</option>
                {sourceSlugs.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </Select>
              <div className="flex justify-end">
                <Tooltip content="Remove mutation">
                  <span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 rounded-lg p-0 text-muted shadow-tactile hover:text-error"
                      aria-label="Remove mutation"
                      onClick={() => onRemoveMutation(mutation.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">entityIdExpr</p>
                <CodeEditor
                  language={scenarioExprLanguageID()}
                  value={mutation.entityIdExpr}
                  onChange={(value) => onMutationEntityExprChange(mutation.id, value)}
                  onMount={onExprMount}
                  height="90px"
                  options={{
                    lineNumbers: 'off',
                    wordWrap: 'on',
                    minimap: { enabled: false },
                    wordBasedSuggestions: 'off',
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onMutationEntityExprChange(mutation.id, 'request.params.path.id')}
                  >
                    request.params.path.id
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  payloadExpr {mutation.type === 'delete' ? '(ignored for delete)' : ''}
                </p>
                <CodeEditor
                  language={scenarioExprLanguageID()}
                  value={mutation.payloadExpr}
                  onChange={(value) => onMutationPayloadExprChange(mutation.id, value)}
                  onMount={onExprMount}
                  readOnly={mutation.type === 'delete'}
                  height="90px"
                  options={{
                    lineNumbers: 'off',
                    wordWrap: 'on',
                    minimap: { enabled: false },
                    wordBasedSuggestions: 'off',
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onMutationPayloadExprChange(mutation.id, 'request.params.body')}
                    disabled={mutation.type === 'delete'}
                  >
                    request.params.body
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
