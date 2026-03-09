import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Trash2, X } from 'lucide-react'
import type { IDisposable, editor as MonacoEditor } from 'monaco-editor'
import type * as Monaco from 'monaco-editor'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  buildCompletionContext,
  createCompletionProvider,
  enrichCompletionContextTypes,
  type EndpointCompletionContext,
} from './completion-provider'
import { buildLocalRequestPaths } from './autocomplete-local-context'
import {
  composeEndpointPath,
  includesPackBasePath,
  isValidRelativeEndpointPath,
  normalizeEndpointPathInput,
  normalizePackBasePath,
  toRelativeEndpointPath,
} from './endpoint-path'
import {
  buildDerivedPathParams,
  createEditableContractParam,
  injectEditableParamsIntoContract,
  parseEditableParamsFromContract,
  type EditableContractParam,
  type EditableContractParamScope,
} from './contract-params'
import { extractPathParamNames, serializePathTemplate, tokenizePathTemplate, validatePathTemplate } from './path-template'
import { PathTemplateInput } from './path-template-input'
import { NewEndpointModal, type EndpointMethod } from './new-endpoint-modal'
import { buildManualImportPayload, supportsRequestBody } from './endpoint-openapi-import'
import { buildBundleCFixtureSet } from './qa-fixtures'
import { compileScenarioDraft, compileScenarioDrafts } from './scenario-compile'
import { registerScenarioExprAssist } from './scenario-expr-monaco'
import {
  addHeader,
  addMutation,
  appendScenario,
  defaultScenarioDraft,
  duplicateScenario,
  headersFromPairs,
  moveScenario,
  normalizeScenarioPriorities,
  removeScenario,
  withoutFallbackScenario,
  withFallbackScenario,
  type ScenarioDiagnostic,
  type ScenarioDraft,
} from './scenario-model'
import { applyHeadersJsonToPairs, parseScenarioDraftsFromJSON } from './scenario-parse'
import { ScenarioMutationsTable } from './scenario-mutations-table'
import { ScenarioPreviewPanel } from './scenario-preview-panel'
import { ScenarioResponseSection } from './scenario-response-section'
import { ScenarioSidebar } from './scenario-sidebar'
import { ScenarioWhenSection } from './scenario-when-section'
import { validateScenarioDraftsStrict } from './scenario-validation'
import { inferRequestBodySchemaFromExample } from './request-body-schema'
import { deriveBundleCViewState } from './state'
import { ENDPOINT_ROUTE_SENTINEL, packEndpointRoute, packRoute } from '../../app/routes/paths'
import {
  formatAPIError,
  getDataSources,
  getDataSourceSchema,
  getEndpoint,
  getEndpointAutocompleteContext,
  getIntegrationPacks,
  getEndpointRevisions,
  importPackRoutes,
  getEndpointTraffic,
  getPackRoutes,
  restoreEndpointRevision,
  updateEndpointAuth,
  updateEndpointContract,
  updateEndpointRoute,
  updateEndpointScenarios,
  validateEndpoint,
} from '../../lib/api'
import { useSessionStore } from '../../app/state/use-session-store'
import { parseBundleCQAState } from '../../shared/lib/qa-state'
import { Alert } from '../../shared/ui/alert'
import { Badge } from '../../shared/ui/badge'
import { Button } from '../../shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../shared/ui/card'
import { CodeEditor } from '../../shared/ui/code-editor'
import { IconActionButton } from '../../shared/ui/icon-action-button'
import { Input } from '../../shared/ui/input'
import { SegmentedControl } from '../../shared/ui/segmented-control'
import { Select } from '../../shared/ui/select'
import { Tooltip } from '../../shared/ui/tooltip'
import type { ContractState, EndpointTab, ScenarioState, TrafficState } from '../../shared/types/ui-state'
import type {
  AutocompleteContext,
  EndpointAuthMode,
  EndpointRevision,
  EndpointScenario,
  TrafficEvent,
  ValidationIssue,
  IntegrationRoute,
} from '../../types/api'

interface EndpointContext {
  title: string
  method: string
  path: string
  versionLabel: string
}

interface TrafficSummary {
  method: string
  path: string
  status: string
  scenario: string
}

const CONTRACT_HEALTH_FALLBACK = [
  { label: 'Schema validity', value: '100%', progress: 100 },
  { label: 'Mock usage (24h)', value: '1,240 calls', progress: 70 },
]

const ENDPOINT_METHOD_OPTIONS: EndpointMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const EDITABLE_PARAM_SCOPE_OPTIONS: EditableContractParamScope[] = ['HEADER', 'QUERY']
const SCENARIO_EXPR_OWNER = 'scenario-expr'

interface ScenarioCompilationView {
  id: string
  scenario: EndpointScenario
  diagnostics: ScenarioDiagnostic[]
}

function readEndpointTab(value: string | null): EndpointTab {
  if (value === 'contract' || value === 'scenarios' || value === 'traffic') {
    return value
  }
  return 'contract'
}

export function EndpointEditorScreen(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { integrationId = '', packId = '', endpointId = '' } = useParams()
  const token = useSessionStore((state) => state.token)
  const selectedEndpointId = endpointId.trim()
  const isLegacyNewEndpoint = selectedEndpointId === ENDPOINT_ROUTE_SENTINEL
  const hasSelectedEndpoint = selectedEndpointId !== '' && !isLegacyNewEndpoint

  const qaState = useMemo(() => parseBundleCQAState(location.search), [location.search])
  const qaFixtures = useMemo(() => buildBundleCFixtureSet(), [])

  const [routes, setRoutes] = useState<IntegrationRoute[]>([])
  const [endpointContext, setEndpointContext] = useState<EndpointContext>(qaFixtures.endpoint)
  const [endpointAuthMode, setEndpointAuthMode] = useState<EndpointAuthMode>('INHERIT')
  const [endpointCustomAuthExpr, setEndpointCustomAuthExpr] = useState("auth.email == 'dev@example.com'")
  const [routeMethod, setRouteMethod] = useState<EndpointMethod>('GET')
  const [routeRelativePath, setRouteRelativePath] = useState('/resource')
  const [savingRoute, setSavingRoute] = useState(false)
  const [savingEndpointAuth, setSavingEndpointAuth] = useState(false)
  const [packName, setPackName] = useState('Pack')
  const [packBasePath, setPackBasePath] = useState('/')
  const [routeFilter, setRouteFilter] = useState('')
  const [isCreateEndpointModalOpen, setIsCreateEndpointModalOpen] = useState(false)
  const [createEndpointMethod, setCreateEndpointMethod] = useState<EndpointMethod>('GET')
  const [createEndpointRelativePath, setCreateEndpointRelativePath] = useState('/resource')
  const [createEndpointRequestBodyExample, setCreateEndpointRequestBodyExample] = useState('')
  const [createEndpointSubmitting, setCreateEndpointSubmitting] = useState(false)
  const [createEndpointError, setCreateEndpointError] = useState('')
  const [editableParams, setEditableParams] = useState<EditableContractParam[]>([])
  const [headerParamsCollapsed, setHeaderParamsCollapsed] = useState(false)

  const [contractText, setContractText] = useState(qaFixtures.contractJson)
  const [contractState, setContractState] = useState<ContractState>('editing')

  const [scenarioDrafts, setScenarioDrafts] = useState<ScenarioDraft[]>([])
  const [scenarioParseDiagnostics, setScenarioParseDiagnostics] = useState<ScenarioDiagnostic[]>([])
  const [scenarioState, setScenarioState] = useState<ScenarioState>('empty')
  const [selectedScenarioId, setSelectedScenarioId] = useState('')

  const [endpointTab, setEndpointTab] = useState<EndpointTab>(readEndpointTab(searchParams.get('tab')))
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([])
  const [revisions, setRevisions] = useState<EndpointRevision[]>([])
  const [revisionsCursor, setRevisionsCursor] = useState<string | undefined>()
  const [loadingRevisions, setLoadingRevisions] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const [trafficEvents, setTrafficEvents] = useState<TrafficEvent[]>([])
  const [trafficState, setTrafficState] = useState<TrafficState>('idle')
  const [selectedTrafficId, setSelectedTrafficId] = useState('')
  const [trafficPollingPaused, setTrafficPollingPaused] = useState(false)
  const [trafficRefreshNonce, setTrafficRefreshNonce] = useState(0)

  const [baseCompletionContext, setBaseCompletionContext] = useState(() => buildCompletionContext(null))
  const [autocompleteNotice, setAutocompleteNotice] = useState('')
  const [error, setError] = useState('')
  const lastGoodCompletionContextRef = useRef<EndpointCompletionContext | null>(null)

  const whenEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const whenModelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const scenarioExprMonacoRef = useRef<typeof Monaco | null>(null)
  const scenarioExprAssistRef = useRef<IDisposable[]>([])

  const resolvedPackBasePath = useMemo(() => normalizePackBasePath(packBasePath), [packBasePath])
  const createEndpointFinalPathPreview = useMemo(
    () => composeEndpointPath(resolvedPackBasePath, normalizeEndpointPathInput(createEndpointRelativePath)),
    [createEndpointRelativePath, resolvedPackBasePath]
  )
  const editedEndpointFinalPath = useMemo(
    () => composeEndpointPath(resolvedPackBasePath, normalizeEndpointPathInput(routeRelativePath)),
    [resolvedPackBasePath, routeRelativePath]
  )
  const currentPathValue = hasSelectedEndpoint ? editedEndpointFinalPath : createEndpointFinalPathPreview
  const pathParamNames = useMemo(() => extractPathParamNames(currentPathValue), [currentPathValue])
  const derivedPathParams = useMemo(() => buildDerivedPathParams(pathParamNames), [pathParamNames])
  const contractParams = useMemo(() => [...editableParams, ...derivedPathParams], [editableParams, derivedPathParams])
  const requestFieldTypeMap = useMemo(() => extractRequestFieldTypes(contractText), [contractText])
  const localRequestPaths = useMemo(
    () =>
      buildLocalRequestPaths({
        endpointPath: currentPathValue,
        editableParams,
        requestFieldTypeMap,
      }),
    [currentPathValue, editableParams, requestFieldTypeMap]
  )
  const completionContext = useMemo(() => {
    const mergedContext: EndpointCompletionContext = {
      ...baseCompletionContext,
      requestPaths: uniqueStrings([...baseCompletionContext.requestPaths, ...localRequestPaths]),
    }
    return enrichCompletionContextTypes(mergedContext, { requestFieldTypes: requestFieldTypeMap })
  }, [baseCompletionContext, localRequestPaths, requestFieldTypeMap])
  const completionProvider = useMemo(() => createCompletionProvider(completionContext), [completionContext])
  const sourceSlugs = useMemo(() => completionProvider.sourceSlugs(), [completionProvider])

  const scenarioCompilations = useMemo<ScenarioCompilationView[]>(() => {
    return scenarioDrafts.map((scenario) => {
      const compiled = compileScenarioDraft(scenario, {
        sourcePaths: completionContext.sourcePaths,
        requestPaths: completionContext.requestPaths,
      })
      return {
        id: scenario.id,
        scenario: compiled.scenario,
        diagnostics: compiled.diagnostics,
      }
    })
  }, [scenarioDrafts, completionContext.requestPaths, completionContext.sourcePaths])

  const scenarioDiagnostics = useMemo(() => {
    return validateScenarioDraftsStrict(scenarioDrafts, {
      sourcePaths: completionContext.sourcePaths,
      requestPaths: completionContext.requestPaths,
      legacyDiagnostics: scenarioParseDiagnostics,
    }).diagnostics
  }, [scenarioDrafts, completionContext.sourcePaths, completionContext.requestPaths, scenarioParseDiagnostics])

  const selectedScenario = useMemo(
    () => scenarioDrafts.find((item) => item.id === selectedScenarioId) ?? scenarioDrafts[0] ?? null,
    [scenarioDrafts, selectedScenarioId]
  )

  const selectedScenarioCompilation = useMemo(
    () => scenarioCompilations.find((item) => item.id === selectedScenario?.id) ?? null,
    [scenarioCompilations, selectedScenario?.id]
  )

  const selectedScenarioDiagnostics = useMemo(
    () => scenarioDiagnostics.filter((item) => item.scenarioId === selectedScenario?.id || item.scenarioId === 'global'),
    [scenarioDiagnostics, selectedScenario?.id]
  )

  const selectedTrafficEvent = useMemo(
    () => trafficEvents.find((event) => event.id === selectedTrafficId) ?? trafficEvents[0] ?? null,
    [trafficEvents, selectedTrafficId]
  )
  const filteredRoutes = useMemo(() => {
    const query = routeFilter.trim().toLowerCase()
    if (query === '') {
      return routes
    }
    return routes.filter((route) => {
      const relativePath = toRelativeEndpointPath(route.path, resolvedPackBasePath).toLowerCase()
      return `${route.method} ${relativePath}`.toLowerCase().includes(query)
    })
  }, [routeFilter, routes, resolvedPackBasePath])

  const contractHealth = qaFixtures.contractHealth.length > 0 ? qaFixtures.contractHealth : CONTRACT_HEALTH_FALLBACK

  const viewState = deriveBundleCViewState({
    qaState,
    endpointId: selectedEndpointId,
    endpointTab,
    contractState,
    scenarioState,
    trafficState,
    error,
  })

  useEffect(() => {
    const queryTab = readEndpointTab(searchParams.get('tab'))
    if (queryTab !== endpointTab) {
      setEndpointTab(queryTab)
    }
  }, [searchParams, endpointTab])

  useEffect(() => {
    if (searchParams.has('tab')) {
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('tab', endpointTab)
    setSearchParams(next, { replace: true })
  }, [endpointTab, searchParams, setSearchParams])

  function selectEndpointTab(nextTab: EndpointTab): void {
    setEndpointTab(nextTab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextTab)
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    if (qaState || !isLegacyNewEndpoint) {
      return
    }
    setIsCreateEndpointModalOpen(true)
    navigate(packRoute(integrationId, packId), { replace: true })
  }, [integrationId, isLegacyNewEndpoint, navigate, packId, qaState])

  useEffect(() => {
    if (!qaState) {
      return
    }

    const fixtureScenarios = qaFixtures.scenarios.map((scenario) => fixtureToEndpointScenario(scenario))
    const fixtureLoad = parseScenarioDraftsFromJSON(JSON.stringify(fixtureScenarios))
    const fixtureDrafts = normalizeScenarioPriorities(
      fixtureLoad.drafts.map((item, index) => ({
        ...item,
        id: `qa-${index + 1}`,
      }))
    )

    setRoutes(qaFixtures.routes)
    setEndpointContext(qaFixtures.endpoint)
    setRouteMethod((qaFixtures.endpoint.method as EndpointMethod) || 'GET')
    setRouteRelativePath(toRelativeEndpointPath(qaFixtures.endpoint.path, resolvedPackBasePath))
    setEndpointAuthMode('INHERIT')
    setEndpointCustomAuthExpr("auth.email == 'qa@example.com'")
    setCreateEndpointMethod('GET')
    setCreateEndpointRelativePath('/resource')
    setIsCreateEndpointModalOpen(false)
    setCreateEndpointError('')
    setEditableParams(
      qaFixtures.headerParams
        .filter((item) => item.scope === 'HEADER' || item.scope === 'QUERY')
        .map((item) => {
          const scope: EditableContractParamScope = item.scope === 'QUERY' ? 'QUERY' : 'HEADER'
          return {
            ...createEditableContractParam(scope),
            key: item.key,
            expectedValue: item.expectedValue,
            required: item.required,
            scope,
          }
        })
    )
    setHeaderParamsCollapsed(false)
    setContractText(qaFixtures.contractJson)
    setContractState(qaFixtures.contractState)
    setScenarioDrafts(fixtureDrafts)
    setScenarioParseDiagnostics(fixtureLoad.diagnostics)
    setSelectedScenarioId(preferredScenarioSelectionID(fixtureDrafts))
    setScenarioState(qaFixtures.scenarioState)
    setTrafficEvents(qaFixtures.trafficEvents)
    setSelectedTrafficId(qaFixtures.trafficEvents[0]?.id || '')
    setTrafficState(qaState === 'traffic-error' ? 'error' : qaFixtures.trafficState)
    setEndpointTab(tabForQAState(qaState))
    setValidationIssues([])
    setRevisions([])
    setRevisionsCursor(undefined)
    setHistoryOpen(false)
    setTrafficPollingPaused(false)
    setError(qaState === 'traffic-error' ? qaFixtures.trafficErrorMessage : '')
  }, [qaState, qaFixtures, resolvedPackBasePath])

  useEffect(() => {
    if (qaState) {
      return
    }

    if (!token || integrationId === '' || packId === '') {
      return
    }

    let cancelled = false

    const loadRoutes = async (): Promise<void> => {
      try {
        const routeItems = await getPackRoutes(token, integrationId, packId)
        if (cancelled) {
          return
        }

        setRoutes(routeItems)

        if (!hasSelectedEndpoint) {
          if (routeItems[0]?.id) {
            navigate(packEndpointRoute(integrationId, packId, routeItems[0].id), { replace: true })
          }
          return
        }

        if (routeItems.length > 0 && !routeItems.some((route) => route.id === selectedEndpointId)) {
          const firstRouteID = routeItems[0]?.id
          if (!firstRouteID) {
            return
          }
          navigate(packEndpointRoute(integrationId, packId, firstRouteID), { replace: true })
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(formatAPIError(requestError))
        }
      }
    }

    void loadRoutes()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, packId, hasSelectedEndpoint, selectedEndpointId, navigate])

  useEffect(() => {
    if (qaState || !token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      return
    }
    if (routes.length > 0) {
      return
    }

    let cancelled = false

    const retryLoadRoutes = async (): Promise<void> => {
      try {
        const routeItems = await getPackRoutes(token, integrationId, packId)
        if (!cancelled && routeItems.length > 0) {
          setRoutes(routeItems)
        }
      } catch {
        // primary loadRoutes effect handles errors
      }
    }

    const timer = setTimeout(() => void retryLoadRoutes(), 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [qaState, token, integrationId, packId, hasSelectedEndpoint, routes.length])

  useEffect(() => {
    if (qaState) {
      setPackName('QA Pack')
      setPackBasePath('/api/v1')
      return
    }

    if (!token || integrationId === '' || packId === '') {
      return
    }

    let cancelled = false

    const loadPackMeta = async (): Promise<void> => {
      try {
        const packs = await getIntegrationPacks(token, integrationId)
        if (cancelled) {
          return
        }
        const activePack = packs.find((item) => item.id === packId)
        if (!activePack) {
          return
        }
        setPackName(activePack.name)
        setPackBasePath(normalizePackBasePath(activePack.basePath))
      } catch {
        if (!cancelled) {
          setPackBasePath('/')
        }
      }
    }

    void loadPackMeta()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, packId])

  useEffect(() => {
    if (qaState) {
      return
    }

    if (!token || integrationId === '' || packId === '') {
      return
    }

    if (!hasSelectedEndpoint) {
      setError('')
      setHeaderParamsCollapsed(false)
      setContractText('{}')
      setContractState('editing')
      setEditableParams([])
      const baseScenario = defaultScenarioDraft(0, false)
      setScenarioDrafts([baseScenario])
      setScenarioParseDiagnostics([])
      setScenarioState('ready')
      setSelectedScenarioId(baseScenario.id)
      setEndpointAuthMode('INHERIT')
      setRouteMethod('GET')
      setRouteRelativePath('/resource')
      setEndpointContext({
        ...qaFixtures.endpoint,
        method: 'GET',
        path: '/users/:id',
        title: 'New Endpoint Draft',
      })
      return
    }

    let cancelled = false

    const loadEditor = async (): Promise<void> => {
      try {
        setError('')
        const payload = await getEndpoint(token, integrationId, selectedEndpointId, packId)
        if (cancelled) {
          return
        }

        setEndpointContext({
          ...qaFixtures.endpoint,
          method: payload.method,
          path: payload.path,
          title: formatEndpointTitle(payload.method, payload.path),
        })
        setRouteMethod((payload.method as EndpointMethod) || 'GET')
        setRouteRelativePath(toRelativeEndpointPath(payload.path, resolvedPackBasePath))
        setEndpointAuthMode(payload.authMode)
        setEndpointCustomAuthExpr(extractCustomAuthExpr(payload.authOverridePolicyJson))
        setHeaderParamsCollapsed(false)
        setContractText(prettyPrintJSON(payload.contractJson))
        setEditableParams(parseEditableParamsFromContract(payload.contractJson))
        setContractState('valid')

        const loadedDrafts = parseScenarioDraftsFromJSON(payload.scenariosJson)
        const normalizedDrafts = normalizeScenarioPriorities(loadedDrafts.drafts)
        setScenarioDrafts(normalizedDrafts)
        setScenarioParseDiagnostics(loadedDrafts.diagnostics)
        setScenarioState(loadedDrafts.diagnostics.length > 0 ? 'error' : normalizedDrafts.length === 0 ? 'empty' : 'ready')
        setSelectedScenarioId(preferredScenarioSelectionID(normalizedDrafts))
      } catch (requestError) {
        if (!cancelled) {
          setContractState('invalid')
          setScenarioState('error')
          setError(formatAPIError(requestError))
        }
      }
    }

    void loadEditor()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, packId, hasSelectedEndpoint, selectedEndpointId, qaFixtures.endpoint, resolvedPackBasePath])

  useEffect(() => {
    if (qaState) {
      setBaseCompletionContext(buildCompletionContext(null))
      setAutocompleteNotice('')
      lastGoodCompletionContextRef.current = null
      return
    }

    if (!token || integrationId === '' || packId === '') {
      setBaseCompletionContext(buildCompletionContext(null))
      return
    }

    if (!hasSelectedEndpoint) {
      setBaseCompletionContext(buildCompletionContext(null))
      setAutocompleteNotice('Autocomplete will load runtime context after selecting or creating an endpoint.')
      return
    }

    let cancelled = false

    const loadAutocompleteContext = async (): Promise<void> => {
      const [runtimeContextResult, dataSourcesResult] = await Promise.allSettled([
        getEndpointAutocompleteContext(token, integrationId, selectedEndpointId, packId),
        getDataSources(token, integrationId),
      ])

      if (cancelled) {
        return
      }

      const activeSources = dataSourcesResult.status === 'fulfilled' ? dataSourcesResult.value : []
      const activeSourceSlugs = activeSources.map((item) => item.slug).filter((item) => item.trim() !== '')
      const sourceSchemaResults =
        activeSources.length > 0
          ? await Promise.allSettled(activeSources.map((item) => getDataSourceSchema(token, integrationId, item.id)))
          : []

      if (cancelled) {
        return
      }

      const sourceAssist = buildSourceAssistFromSchemas(activeSources, sourceSchemaResults)

      if (runtimeContextResult.status === 'fulfilled') {
        const enrichedContext = enrichAutocompleteContext(runtimeContextResult.value, activeSourceSlugs, sourceAssist.paths)
        const baseContext = buildCompletionContext(enrichedContext)
        const nextBaseContext = enrichCompletionContextTypes(baseContext, {
          sourceFieldTypes: sourceAssist.types,
        })
        setBaseCompletionContext(nextBaseContext)
        lastGoodCompletionContextRef.current = nextBaseContext
        setAutocompleteNotice('')
        return
      }

      const cachedContext = lastGoodCompletionContextRef.current
      if (cachedContext) {
        const cachedWithSources = enrichCompletionContextTypes(cachedContext, {
          sourceFieldTypes: sourceAssist.types,
        })
        setBaseCompletionContext(cachedWithSources)
        lastGoodCompletionContextRef.current = cachedWithSources
        setAutocompleteNotice(`Autocomplete using cached context: ${formatAPIError(runtimeContextResult.reason)}`)
        return
      }

      const fallbackContext = enrichAutocompleteContext(null, activeSourceSlugs, sourceAssist.paths)
      const baseContext = buildCompletionContext(fallbackContext)
      setBaseCompletionContext(
        enrichCompletionContextTypes(baseContext, {
          sourceFieldTypes: sourceAssist.types,
        })
      )
      setAutocompleteNotice(`Autocomplete fallback active: ${formatAPIError(runtimeContextResult.reason)}`)
    }

    void loadAutocompleteContext()

    return () => {
      cancelled = true
    }
  }, [qaState, token, integrationId, packId, hasSelectedEndpoint, selectedEndpointId])

  useEffect(() => {
    if (scenarioDrafts.length === 0) {
      setSelectedScenarioId('')
      return
    }
    if (!scenarioDrafts.some((item) => item.id === selectedScenarioId)) {
      setSelectedScenarioId(preferredScenarioSelectionID(scenarioDrafts))
    }
  }, [scenarioDrafts, selectedScenarioId])

  useEffect(() => {
    if (endpointTab !== 'traffic') {
      setTrafficPollingPaused(false)
      setTrafficState((current) => (current === 'streaming' ? 'paused' : current))
    }
  }, [endpointTab])

  useEffect(() => {
    if (qaState) {
      return
    }

    if (!token || integrationId === '' || packId === '' || endpointTab !== 'traffic' || !hasSelectedEndpoint) {
      return
    }

    if (trafficPollingPaused) {
      setTrafficState('paused')
      return
    }

    let active = true

    const tick = async (): Promise<void> => {
      try {
        const events = await getEndpointTraffic(token, integrationId, selectedEndpointId, packId)
        if (!active) {
          return
        }

        setTrafficEvents(events)
        setSelectedTrafficId((current) => current || events[0]?.id || '')
        setTrafficState('streaming')
        setError('')
      } catch (requestError) {
        if (!active) {
          return
        }
        setTrafficState('error')
        setError(formatAPIError(requestError))
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 4000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [qaState, token, integrationId, packId, selectedEndpointId, endpointTab, trafficPollingPaused, trafficRefreshNonce])

  useEffect(() => {
    const hasDiagnostics = scenarioDiagnostics.length > 0
    const nextState: ScenarioState = scenarioDrafts.length === 0 ? 'empty' : hasDiagnostics ? 'error' : 'ready'

    setScenarioState((current) => (current === 'saving' ? current : nextState))
  }, [scenarioDrafts.length, scenarioDiagnostics])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
        return
      }
      event.preventDefault()
      if (endpointTab === 'scenarios') {
        void saveScenarios()
        return
      }
      if (endpointTab === 'contract') {
        void saveContract()
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [endpointTab, integrationId, packId, selectedEndpointId, token, contractText, scenarioDrafts, scenarioDiagnostics, scenarioParseDiagnostics])

  useEffect(() => {
    if (!scenarioExprMonacoRef.current || !whenModelRef.current) {
      return
    }

    const monaco = scenarioExprMonacoRef.current
    const model = whenModelRef.current

    const whenIssues = selectedScenarioDiagnostics.filter((item) => item.field === 'when')
    monaco.editor.setModelMarkers(
      model,
      SCENARIO_EXPR_OWNER,
      whenIssues.map((item) => ({
        code: item.code,
        message: item.message,
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: Math.max(1, Math.min(item.line, model.getLineCount())),
        startColumn: Math.max(1, item.column),
        endLineNumber: Math.max(1, Math.min(item.endLine, model.getLineCount())),
        endColumn: Math.max(2, item.endColumn),
      }))
    )
  }, [selectedScenarioDiagnostics])

  useEffect(() => {
    if (!scenarioExprMonacoRef.current) {
      return
    }

    scenarioExprAssistRef.current.forEach((item) => item.dispose())
    scenarioExprAssistRef.current = registerScenarioExprAssist(scenarioExprMonacoRef.current, completionProvider)

    return () => {
      scenarioExprAssistRef.current.forEach((item) => item.dispose())
      scenarioExprAssistRef.current = []
    }
  }, [completionProvider])

  function onExprEditorMount(_editorInstance: MonacoEditor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    _editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
      _editorInstance.trigger('keyboard', 'editor.action.triggerSuggest', {})
    })
    _editorInstance.updateOptions({
      suggestOnTriggerCharacters: true,
      quickSuggestions: { other: true, comments: true, strings: true },
      wordBasedSuggestions: 'off',
      suggest: { showWords: false },
    })

    scenarioExprMonacoRef.current = monaco
    scenarioExprAssistRef.current.forEach((item) => item.dispose())
    scenarioExprAssistRef.current = registerScenarioExprAssist(monaco, completionProvider)
  }

  function onWhenEditorMount(editorInstance: MonacoEditor.IStandaloneCodeEditor, monaco: typeof Monaco): void {
    whenEditorRef.current = editorInstance
    whenModelRef.current = editorInstance.getModel()
    onExprEditorMount(editorInstance, monaco)
  }

  function selectScenario(id: string): void {
    setSelectedScenarioId(id)
    whenEditorRef.current?.focus()
  }

  function createScenario(): void {
    setScenarioDrafts((current) => {
      const next = appendScenario(current)
      setSelectedScenarioId(next[next.length - 1]?.id ?? '')
      return next
    })
    setError('')
  }

  function duplicateSelectedScenario(id: string): void {
    setScenarioDrafts((current) => {
      const before = new Set(current.map((item) => item.id))
      const next = duplicateScenario(current, id)
      const duplicated = next.find((item) => !before.has(item.id))
      if (duplicated) {
        setSelectedScenarioId(duplicated.id)
      }
      return next
    })
    setError('')
  }

  function moveScenarioItem(id: string, direction: -1 | 1): void {
    setScenarioState('reordering')
    setScenarioDrafts((current) => moveScenario(current, id, direction))
    setError('')
  }

  function deleteScenarioItem(id: string): void {
    setScenarioDrafts((current) => {
      const next = removeScenario(current, id)
      setSelectedScenarioId((currentSelected) =>
        next.some((item) => item.id === currentSelected) ? currentSelected : preferredScenarioSelectionID(next)
      )
      return next
    })
    setError('')
  }

  function setScenarioAsFallback(id: string): void {
    setScenarioDrafts((current) => withFallbackScenario(current, id))
    setSelectedScenarioId(id)
    setError('')
  }

  function unsetScenarioFallback(id: string): void {
    setScenarioDrafts((current) => withoutFallbackScenario(current, id))
    setSelectedScenarioId(id)
    setError('')
  }

  function closeCreateEndpointModal(): void {
    setIsCreateEndpointModalOpen(false)
    setCreateEndpointMethod('GET')
    setCreateEndpointRelativePath('/resource')
    setCreateEndpointRequestBodyExample('')
    setCreateEndpointError('')
  }

  async function createEndpointFromModal(): Promise<void> {
    if (qaState || !token || integrationId === '' || packId === '') {
      return
    }

    const relativePath = normalizeEndpointPathInput(createEndpointRelativePath)
    if (!isValidRelativeEndpointPath(relativePath)) {
      setCreateEndpointError('Relative path must start with "/" and include at least one segment.')
      return
    }
    if (includesPackBasePath(relativePath, resolvedPackBasePath)) {
      setCreateEndpointError('Do not include pack base path; it is prefixed automatically.')
      return
    }

    const fullPath = composeEndpointPath(resolvedPackBasePath, relativePath)
    const pathIssues = validatePathTemplate(fullPath)
    if (pathIssues.length > 0) {
      setCreateEndpointError(pathIssues.join(' '))
      return
    }

    const duplicateRoute = routes.some(
      (route) =>
        route.method.toUpperCase() === createEndpointMethod &&
        normalizePathForComparison(route.path) === normalizePathForComparison(fullPath)
    )
    if (duplicateRoute) {
      setCreateEndpointError('Route already exists in this pack.')
      return
    }

    try {
      setCreateEndpointSubmitting(true)
      setCreateEndpointError('')
      setError('')

      const openAPIPath = toOpenAPIPath(fullPath)
      const requestBodyExampleRaw = createEndpointRequestBodyExample.trim()
      let requestBodyPayload: { example: unknown; schema: Record<string, unknown> } | null = null
      if (supportsRequestBody(createEndpointMethod) && requestBodyExampleRaw !== '') {
        let parsedBodyExample: unknown
        try {
          parsedBodyExample = JSON.parse(requestBodyExampleRaw) as unknown
        } catch {
          setCreateEndpointError('Request body example must be valid JSON.')
          return
        }

        requestBodyPayload = {
          example: parsedBodyExample,
          schema: inferRequestBodySchemaFromExample(parsedBodyExample),
        }
      }

      const payload = buildManualImportPayload(createEndpointMethod, openAPIPath, requestBodyPayload)
      const result = await importPackRoutes(token, integrationId, packId, 'OPENAPI', payload)
      if (result.errors.length > 0) {
        setCreateEndpointError(result.errors.join('; '))
        return
      }

      const routeItems = await getPackRoutes(token, integrationId, packId)
      setRoutes(routeItems)

      const createdRoute = routeItems.find(
        (route) =>
          route.method.toUpperCase() === createEndpointMethod &&
          normalizePathForComparison(route.path) === normalizePathForComparison(openAPIPath)
      )

      if (!createdRoute) {
        setCreateEndpointError('Route created but not resolvable in route list. Select it manually from the route selector.')
        return
      }

      closeCreateEndpointModal()
      navigate(packEndpointRoute(integrationId, packId, createdRoute.id), { replace: true })
    } catch (requestError) {
      setCreateEndpointError(formatAPIError(requestError))
    } finally {
      setCreateEndpointSubmitting(false)
    }
  }

  async function saveEndpointRouteConfig(): Promise<void> {
    if (qaState) {
      return
    }
    if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      setError('Select an endpoint before editing method/path.')
      return
    }

    const normalizedRelativePath = normalizeEndpointPathInput(routeRelativePath)
    if (includesPackBasePath(normalizedRelativePath, resolvedPackBasePath)) {
      setError('Relative path cannot include pack base path prefix.')
      return
    }
    const nextPath = composeEndpointPath(resolvedPackBasePath, normalizedRelativePath)
    const pathIssues = validatePathTemplate(nextPath)
    if (pathIssues.length > 0) {
      setError(pathIssues.join(' '))
      return
    }

    const duplicateRoute = routes.some(
      (route) =>
        route.id !== selectedEndpointId &&
        route.method.toUpperCase() === routeMethod &&
        normalizePathForComparison(route.path) === normalizePathForComparison(nextPath)
    )
    if (duplicateRoute) {
      setError('Route already exists in this pack.')
      return
    }

    try {
      setSavingRoute(true)
      setError('')
      const updatedRoute = await updateEndpointRoute(token, integrationId, packId, selectedEndpointId, {
        method: routeMethod,
        relativePath: normalizedRelativePath,
      })

      const routeItems = await getPackRoutes(token, integrationId, packId)
      setRoutes(routeItems)
      setRouteMethod((updatedRoute.method as EndpointMethod) || 'GET')
      setRouteRelativePath(toRelativeEndpointPath(updatedRoute.path, resolvedPackBasePath))
      setEndpointContext((current) => ({
        ...current,
        method: updatedRoute.method,
        path: updatedRoute.path,
        title: formatEndpointTitle(updatedRoute.method, updatedRoute.path),
      }))
      navigate(packEndpointRoute(integrationId, packId, updatedRoute.id), { replace: true })
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setSavingRoute(false)
    }
  }

  function buildContractWithEditableParams(): string {
    return injectEditableParamsIntoContract(contractText, editableParams)
  }

  async function saveContract(): Promise<void> {
    if (qaState) {
      setContractState('valid')
      setError('')
      return
    }

    if (!token || integrationId === '' || packId === '') {
      return
    }

    if (!hasSelectedEndpoint) {
      setError('Select an endpoint from the list before saving contract.')
      return
    }

    let contractWithParams: string
    try {
      contractWithParams = buildContractWithEditableParams()
    } catch (injectError) {
      setContractState('invalid')
      setError(injectError instanceof Error ? injectError.message : 'Contract must be a valid JSON object.')
      return
    }

    const parsed = tryParseJSON(contractWithParams)
    if (!parsed || Array.isArray(parsed)) {
      setContractState('invalid')
      setError('Contract must be a valid JSON object.')
      return
    }

    try {
      setContractState('saving')
      setError('')
      await updateEndpointContract(token, integrationId, selectedEndpointId, JSON.stringify(parsed), packId)
      setContractText(JSON.stringify(parsed, null, 2))
      setEditableParams(parseEditableParamsFromContract(JSON.stringify(parsed)))
      setContractState('valid')
    } catch (requestError) {
      setContractState('invalid')
      setError(formatAPIError(requestError))
    }
  }

  function buildCompiledScenariosForSave(): { scenarios: EndpointScenario[]; diagnostics: ScenarioDiagnostic[] } {
    const normalizedDrafts = normalizeScenarioPriorities(scenarioDrafts)
    const validation = validateScenarioDraftsStrict(normalizedDrafts, {
      sourcePaths: completionContext.sourcePaths,
      requestPaths: completionContext.requestPaths,
      legacyDiagnostics: scenarioParseDiagnostics,
    })
    const compiled = compileScenarioDrafts(normalizedDrafts, {
      sourcePaths: completionContext.sourcePaths,
      requestPaths: completionContext.requestPaths,
    })

    return {
      scenarios: compiled.scenarios,
      diagnostics: validation.diagnostics,
    }
  }

  async function saveScenarios(): Promise<void> {
    const compiled = buildCompiledScenariosForSave()

    if (qaState) {
      if (compiled.diagnostics.length > 0) {
        setScenarioState('error')
        setError(compiled.diagnostics.map((item) => item.message).join('; '))
        return
      }
      setScenarioState('ready')
      setError('')
      return
    }

    if (!token || integrationId === '' || packId === '') {
      return
    }

    if (!hasSelectedEndpoint) {
      setScenarioState('error')
      setError('Select an endpoint from the left panel before saving scenarios.')
      return
    }

    if (compiled.diagnostics.length > 0) {
      setScenarioState('error')
      setError(compiled.diagnostics.map((item) => item.message).join('; '))
      return
    }

    try {
      setScenarioState('saving')
      setError('')
      const contractForValidation = buildContractWithEditableParams()
      const validation = await validateEndpoint(
        token,
        integrationId,
        selectedEndpointId,
        {
          contract: contractForValidation,
          scenarios: JSON.stringify(compiled.scenarios),
        },
        packId
      )
      setValidationIssues(validation.issues)
      if (!validation.valid) {
        setScenarioState('error')
        setError('Validation reported issues. Review details before saving scenarios.')
        return
      }
      await updateEndpointScenarios(token, integrationId, selectedEndpointId, compiled.scenarios, packId)
      const reloaded = parseScenarioDraftsFromJSON(JSON.stringify(compiled.scenarios))
      const normalizedDrafts = normalizeScenarioPriorities(reloaded.drafts)
      setScenarioDrafts(normalizedDrafts)
      setScenarioParseDiagnostics(reloaded.diagnostics)
      setSelectedScenarioId((current) => current || preferredScenarioSelectionID(normalizedDrafts))
      setScenarioState('ready')
    } catch (requestError) {
      setScenarioState('error')
      setError(formatAPIError(requestError))
    }
  }

  async function runValidation(): Promise<void> {
    if (qaState) {
      setValidationIssues([])
      setError('')
      return
    }

    if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      setError('Select or create an endpoint before running validation.')
      return
    }

    const compiled = buildCompiledScenariosForSave()
    if (compiled.diagnostics.length > 0) {
      setValidationIssues([])
      setScenarioState('error')
      setError(compiled.diagnostics.map((item) => item.message).join('; '))
      return
    }

    try {
      setError('')
      const contractForValidation = buildContractWithEditableParams()
      const result = await validateEndpoint(
        token,
        integrationId,
        selectedEndpointId,
        {
          contract: contractForValidation,
          scenarios: JSON.stringify(compiled.scenarios),
        },
        packId
      )
      setValidationIssues(result.issues)
      if (!result.valid) {
        setError('Validation reported issues. Review details before publishing.')
      }
    } catch (requestError) {
      setValidationIssues([])
      setError(formatAPIError(requestError))
    }
  }

  async function openHistoryPanel(): Promise<void> {
    if (qaState) {
      setHistoryOpen(true)
      return
    }
    if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      return
    }
    setHistoryOpen(true)
    try {
      setLoadingRevisions(true)
      setError('')
      const result = await getEndpointRevisions(token, integrationId, selectedEndpointId, { limit: 20 }, packId)
      setRevisions(result.items)
      setRevisionsCursor(result.nextCursor)
    } catch (requestError) {
      setRevisions([])
      setError(formatAPIError(requestError))
    } finally {
      setLoadingRevisions(false)
    }
  }

  async function restoreRevisionByID(revisionID: string): Promise<void> {
    if (qaState) {
      return
    }
    if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      return
    }
    try {
      setError('')
      await restoreEndpointRevision(token, integrationId, selectedEndpointId, revisionID, packId)
      const [endpointPayload, revisionsPayload] = await Promise.all([
        getEndpoint(token, integrationId, selectedEndpointId, packId),
        getEndpointRevisions(token, integrationId, selectedEndpointId, { limit: 20 }, packId),
      ])
      setContractText(prettyPrintJSON(endpointPayload.contractJson))
      setEditableParams(parseEditableParamsFromContract(endpointPayload.contractJson))
      const loadedDrafts = parseScenarioDraftsFromJSON(endpointPayload.scenariosJson)
      const normalizedDrafts = normalizeScenarioPriorities(loadedDrafts.drafts)
      setScenarioDrafts(normalizedDrafts)
      setScenarioParseDiagnostics(loadedDrafts.diagnostics)
      setSelectedScenarioId(preferredScenarioSelectionID(normalizedDrafts))
      setRevisions(revisionsPayload.items)
      setRevisionsCursor(revisionsPayload.nextCursor)
    } catch (requestError) {
      setError(formatAPIError(requestError))
    }
  }

  async function saveEndpointAuthConfig(): Promise<void> {
    if (qaState) {
      return
    }
    if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
      setError('Select an endpoint before updating auth mode.')
      return
    }

    try {
      setSavingEndpointAuth(true)
      setError('')
      if (endpointAuthMode === 'OVERRIDE') {
        await updateEndpointAuth(token, integrationId, packId, selectedEndpointId, {
          authMode: 'OVERRIDE',
          overridePolicy: {
            mode: 'CUSTOM_EXPR',
            prebuilt: defaultPrebuiltAuthPolicy(),
            customExpr: endpointCustomAuthExpr.trim() === '' ? 'true' : endpointCustomAuthExpr.trim(),
          },
        })
        setRoutes((current) =>
          current.map((route) =>
            route.id === selectedEndpointId
              ? {
                  ...route,
                  authMode: 'OVERRIDE',
                }
              : route
          )
        )
      } else {
        await updateEndpointAuth(token, integrationId, packId, selectedEndpointId, {
          authMode: endpointAuthMode,
        })
        setRoutes((current) =>
          current.map((route) =>
            route.id === selectedEndpointId
              ? {
                  ...route,
                  authMode: endpointAuthMode,
                }
              : route
          )
        )
      }
    } catch (requestError) {
      setError(formatAPIError(requestError))
    } finally {
      setSavingEndpointAuth(false)
    }
  }

  function triggerTrafficRefresh(): void {
    setTrafficRefreshNonce((current) => current + 1)
  }

  function toggleTrafficPause(): void {
    if (trafficPollingPaused) {
      setTrafficPollingPaused(false)
      setTrafficState('streaming')
      triggerTrafficRefresh()
      return
    }

    setTrafficPollingPaused(true)
    setTrafficState('paused')
  }

  function updateScenarioByID(scenarioId: string, updater: (item: ScenarioDraft) => ScenarioDraft): void {
    setScenarioDrafts((current) => current.map((item) => (item.id === scenarioId ? updater(item) : item)))
  }

  function updateSelectedScenario(updater: (item: ScenarioDraft) => ScenarioDraft): void {
    if (!selectedScenarioId) {
      return
    }
    updateScenarioByID(selectedScenarioId, updater)
  }

  function applyHeadersJsonToSimpleMode(): void {
    if (!selectedScenario) {
      return
    }
    const pairs = applyHeadersJsonToPairs(selectedScenario.response.headersJson)
    if (!pairs) {
      setError('Headers advanced JSON must be a valid JSON object before applying to simple mode.')
      return
    }
    updateSelectedScenario((item) => ({
      ...item,
      response: {
        ...item.response,
        headersMode: 'simple',
        headers: pairs.length > 0 ? pairs : item.response.headers,
      },
    }))
  }

  function formatSelectedBodyJSON(): void {
    if (!selectedScenario) {
      return
    }
    const parsed = tryParseJSON(selectedScenario.response.bodyJson)
    if (!isObject(parsed)) {
      setError('Response body must be a valid JSON object to format.')
      return
    }
    updateSelectedScenario((item) => ({
      ...item,
      response: {
        ...item.response,
        bodyJson: JSON.stringify(parsed, null, 2),
      },
    }))
  }

  function useCommonBodyTemplate(): void {
    updateSelectedScenario((item) => ({
      ...item,
      response: {
        ...item.response,
        bodyJson: '{\n  "ok": true,\n  "timestamp": "{{request.params.path.id}}"\n}',
      },
    }))
  }

  const selectedTrafficSummary = parseTrafficSummary(selectedTrafficEvent)
  const effectiveEndpointAuthLabel =
    endpointAuthMode === 'INHERIT'
      ? 'Inherit pack auth'
      : endpointAuthMode === 'OVERRIDE'
        ? 'Custom endpoint auth'
        : 'No auth'
  const headerMethod = hasSelectedEndpoint ? routeMethod : 'NONE'
  const headerPath = hasSelectedEndpoint ? editedEndpointFinalPath : 'No endpoint selected'
  const headerParamCount = contractParams.length
  const headerParamCountLabel = `${headerParamCount} ${headerParamCount === 1 ? 'param' : 'params'}`
  const viewStateVariant = viewState === 'error' || viewState === 'traffic-error' ? 'error' : 'info'

  return (
    <section className="screen-b-font min-h-screen bg-surface-base text-text">
      <div className="w-full px-6 py-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text">{packName}</p>
                    <p className="mt-1 text-xs text-muted">
                      Base path <span className="font-mono text-text">{resolvedPackBasePath}</span>
                    </p>
                  </div>
                  <Badge variant={viewStateVariant}>{viewState}</Badge>
                </div>
                <Button className="w-full" onClick={() => setIsCreateEndpointModalOpen(true)}>
                  + New Endpoint
                </Button>
                <Input
                  aria-label="Filter pack endpoints"
                  placeholder="Filter endpoints..."
                  value={routeFilter}
                  onChange={(event) => setRouteFilter(event.target.value)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Routes</p>
                  <Badge variant="neutral">{filteredRoutes.length}</Badge>
                </div>
                {filteredRoutes.length === 0 ? <p className="text-xs text-muted">No endpoints in this pack yet.</p> : null}
                <div className="max-h-[68vh] space-y-2 overflow-auto pr-1">
                  {filteredRoutes.map((route) => {
                    const selected = route.id === selectedEndpointId
                    return (
                      <button
                        key={route.id}
                        className={
                          selected
                            ? 'w-full rounded-xl border border-primary bg-primary/10 px-3 py-2 text-left'
                            : 'w-full rounded-xl border border-border bg-surface-soft px-3 py-2 text-left hover:border-primary/40'
                        }
                        type="button"
                        onClick={() => navigate(packEndpointRoute(integrationId, packId, route.id))}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <Badge variant="success">{route.method}</Badge>
                          <Badge variant="neutral">{route.authMode ?? 'INHERIT'}</Badge>
                        </div>
                        <p className="truncate font-mono text-xs text-text">
                          {toRelativeEndpointPath(route.path, resolvedPackBasePath)}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={hasSelectedEndpoint ? 'success' : 'neutral'}>{headerMethod}</Badge>
                  <span
                    className={
                      hasSelectedEndpoint
                        ? 'rounded-lg border border-border bg-surface-soft px-3 py-1 text-sm font-mono text-primary-dark'
                        : 'rounded-lg border border-border bg-surface-soft px-3 py-1 text-sm font-semibold text-muted'
                    }
                  >
                    {headerPath}
                  </span>
                  <Badge variant={endpointAuthMode === 'NONE' ? 'warning' : endpointAuthMode === 'OVERRIDE' ? 'info' : 'success'}>
                    {hasSelectedEndpoint ? effectiveEndpointAuthLabel : 'Select a route'}
                  </Badge>
                </div>

                {hasSelectedEndpoint ? (
                  <>
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-[140px_minmax(0,1fr)_auto]">
                      <Select
                        value={routeMethod}
                        onChange={(event) => setRouteMethod(event.target.value as EndpointMethod)}
                        disabled={!hasSelectedEndpoint || savingRoute}
                        aria-label="Endpoint method"
                      >
                        {ENDPOINT_METHOD_OPTIONS.map((methodOption) => (
                          <option key={methodOption} value={methodOption}>
                            {methodOption}
                          </option>
                        ))}
                      </Select>
                      <div className="flex items-start overflow-hidden rounded-xl border border-border/90 bg-surface-inset shadow-inset">
                        <span className="inline-flex h-10 items-center border-r border-border px-3 text-sm font-mono font-semibold text-primary-dark">
                          {resolvedPackBasePath}
                        </span>
                        <PathTemplateInput
                          value={routeRelativePath}
                          onChange={setRouteRelativePath}
                          placeholder="/resource/:id"
                          ariaLabel="Endpoint relative path"
                          disabled={!hasSelectedEndpoint || savingRoute}
                          className="min-h-10 flex-1 rounded-none border-0 bg-transparent shadow-none focus-within:border-0 focus-within:ring-0"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveEndpointRouteConfig()}
                        disabled={!hasSelectedEndpoint || savingRoute}
                      >
                        {savingRoute ? 'Saving...' : 'Save Route'}
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-[220px_minmax(0,1fr)_auto_auto_auto]">
                      <SegmentedControl
                        value={endpointAuthMode}
                        onChange={(next) => setEndpointAuthMode(next as EndpointAuthMode)}
                        options={[
                          { value: 'INHERIT', label: 'Inherit' },
                          { value: 'OVERRIDE', label: 'Custom' },
                          { value: 'NONE', label: 'None' },
                        ]}
                        ariaLabel="Endpoint auth mode"
                        disabled={!hasSelectedEndpoint || savingEndpointAuth}
                      />
                      {endpointAuthMode === 'OVERRIDE' ? (
                        <Input
                          value={endpointCustomAuthExpr}
                          onChange={(event) => setEndpointCustomAuthExpr(event.target.value)}
                          aria-label="Endpoint custom auth expression"
                          placeholder="auth.email == 'dev@example.com'"
                          disabled={!hasSelectedEndpoint || savingEndpointAuth}
                        />
                      ) : (
                        <Input value={effectiveEndpointAuthLabel} readOnly aria-label="Effective endpoint auth" />
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveEndpointAuthConfig()}
                        disabled={!hasSelectedEndpoint || savingEndpointAuth}
                      >
                        {savingEndpointAuth ? 'Applying...' : 'Apply Auth'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void runValidation()} disabled={!hasSelectedEndpoint}>
                        Validate
                      </Button>
                      <Button size="sm" onClick={() => void saveScenarios()} disabled={!hasSelectedEndpoint}>
                        Publish
                      </Button>
                    </div>

                    {validationIssues.length > 0 ? (
                      <Alert tone="warning">
                        <div className="space-y-1">
                          <p className="font-semibold">Validation issues</p>
                          {validationIssues.slice(0, 6).map((issue) => (
                            <p key={`${issue.code}-${issue.path}-${issue.message}`} className="text-xs">
                              [{issue.path || 'payload'}] {issue.message}
                            </p>
                          ))}
                        </div>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-border bg-surface-soft px-4 py-4 text-sm text-muted">
                    <p className="font-semibold text-text">No endpoint selected</p>
                    <p className="mt-1">
                      {routes.length === 0
                        ? 'This pack has no endpoints yet. Create one to unlock editor actions.'
                        : 'Select an endpoint from the left rail to edit contract, scenarios, and traffic.'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => setIsCreateEndpointModalOpen(true)}>
                        + New Endpoint
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="rounded-2xl border border-border bg-surface-raised shadow-card">
              <div className="border-b border-border px-5 py-3">
                <div className="inline-flex rounded-xl border border-border bg-surface-soft p-1">
                  <button
                    type="button"
                    className={
                      !hasSelectedEndpoint
                        ? 'cursor-not-allowed rounded-lg px-4 py-1.5 text-sm font-semibold text-muted/60'
                        : endpointTab === 'contract'
                          ? 'rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white'
                          : 'rounded-lg px-4 py-1.5 text-sm font-semibold text-muted hover:text-text'
                    }
                    disabled={!hasSelectedEndpoint}
                    onClick={() => selectEndpointTab('contract')}
                  >
                    Contract
                  </button>
                  <button
                    type="button"
                    className={
                      !hasSelectedEndpoint
                        ? 'cursor-not-allowed rounded-lg px-4 py-1.5 text-sm font-semibold text-muted/60'
                        : endpointTab === 'scenarios'
                          ? 'rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white'
                          : 'rounded-lg px-4 py-1.5 text-sm font-semibold text-muted hover:text-text'
                    }
                    disabled={!hasSelectedEndpoint}
                    onClick={() => selectEndpointTab('scenarios')}
                  >
                    Scenarios
                  </button>
                  <button
                    type="button"
                    className={
                      !hasSelectedEndpoint
                        ? 'cursor-not-allowed rounded-lg px-4 py-1.5 text-sm font-semibold text-muted/60'
                        : endpointTab === 'traffic'
                          ? 'rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white'
                          : 'rounded-lg px-4 py-1.5 text-sm font-semibold text-muted hover:text-text'
                    }
                    disabled={!hasSelectedEndpoint}
                    onClick={() => selectEndpointTab('traffic')}
                  >
                    Traffic
                  </button>
                </div>
              </div>

              <div className="p-5">
                {!hasSelectedEndpoint ? (
                  <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-border bg-surface-soft px-6 text-center">
                    <p className="text-2xl font-semibold text-text">No endpoint selected</p>
                    <p className="mt-2 max-w-xl text-sm text-muted">
                      {routes.length === 0
                        ? 'This pack has no endpoints yet. Create your first endpoint to continue.'
                        : 'Select an endpoint from the left rail to open Contract, Scenarios, and Traffic tabs.'}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <Button onClick={() => setIsCreateEndpointModalOpen(true)}>+ New Endpoint</Button>
                      {routeFilter.trim() !== '' ? (
                        <Button variant="secondary" onClick={() => setRouteFilter('')}>
                          Clear filter
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {hasSelectedEndpoint && endpointTab === 'contract' ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <CardTitle>Headers &amp; Query Params</CardTitle>
                        {headerParamsCollapsed ? <Badge variant="neutral">{headerParamCountLabel}</Badge> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditableParams((current) => [...current, createEditableContractParam('HEADER')])}
                        >
                          Add Param
                        </Button>
                        <Tooltip
                          content={headerParamsCollapsed ? 'Expand parameters' : 'Collapse parameters'}
                          side="bottom"
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            aria-label={headerParamsCollapsed ? 'Expand parameters' : 'Collapse parameters'}
                            title={headerParamsCollapsed ? 'Expand parameters' : 'Collapse parameters'}
                            onClick={() => setHeaderParamsCollapsed((current) => !current)}
                          >
                            <ChevronDown
                              className={
                                headerParamsCollapsed
                                  ? 'h-4 w-4 transition-transform'
                                  : 'h-4 w-4 rotate-180 transition-transform'
                              }
                              aria-hidden
                            />
                          </Button>
                        </Tooltip>
                      </div>
                    </CardHeader>
                    {headerParamsCollapsed ? null : (
                      <CardContent>
                        <div className="rounded-xl border border-border">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_120px_90px] gap-3 border-b border-border bg-surface-soft px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            <span>Key</span>
                            <span>Expected Value</span>
                            <span className="text-center">Required</span>
                            <span>Scope</span>
                            <span className="text-right">Actions</span>
                          </div>
                          {editableParams.map((param) => (
                            <div
                              key={param.id}
                              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_120px_90px] items-center gap-3 border-b border-border/70 px-3 py-2 text-sm"
                            >
                              <Input
                                value={param.key}
                                onChange={(event) => {
                                  setEditableParams((current) =>
                                    current.map((item) => (item.id === param.id ? { ...item, key: event.target.value } : item))
                                  )
                                }}
                              />
                              <Input
                                value={param.expectedValue}
                                onChange={(event) => {
                                  setEditableParams((current) =>
                                    current.map((item) => (item.id === param.id ? { ...item, expectedValue: event.target.value } : item))
                                  )
                                }}
                              />
                              <label className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  checked={param.required}
                                  onChange={(event) => {
                                    setEditableParams((current) =>
                                      current.map((item) => (item.id === param.id ? { ...item, required: event.target.checked } : item))
                                    )
                                  }}
                                />
                              </label>
                              <Select
                                value={param.scope}
                                onChange={(event) => {
                                  const nextScope = isEditableParamScope(event.target.value) ? event.target.value : 'HEADER'
                                  setEditableParams((current) =>
                                    current.map((item) => (item.id === param.id ? { ...item, scope: nextScope } : item))
                                  )
                                }}
                              >
                                {EDITABLE_PARAM_SCOPE_OPTIONS.map((scopeOption) => (
                                  <option key={scopeOption} value={scopeOption}>
                                    {scopeOption}
                                  </option>
                                ))}
                              </Select>
                              <div className="flex justify-end">
                                <Tooltip content="Remove parameter">
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-muted hover:text-error"
                                      aria-label="Remove parameter"
                                      onClick={() => setEditableParams((current) => current.filter((item) => item.id !== param.id))}
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </span>
                                </Tooltip>
                              </div>
                            </div>
                          ))}
                          {derivedPathParams.map((param) => (
                            <div
                              key={`path-${param.key}`}
                              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_120px_90px] items-center gap-3 border-b border-border/70 bg-primary/5 px-3 py-2 text-sm last:border-b-0"
                            >
                              <Input value={param.key} readOnly />
                              <Input value={param.expectedValue} readOnly />
                              <label className="flex items-center justify-center">
                                <input type="checkbox" checked={param.required} disabled />
                              </label>
                              <span className="inline-flex w-fit rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary-dark">
                                PATH
                              </span>
                              <div className="flex justify-end">
                                <Tooltip content="Path parameters are derived from URL and cannot be removed">
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-muted hover:text-error"
                                      aria-label="Path parameters are read-only"
                                      disabled
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </span>
                                </Tooltip>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Response Schema Definition</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={contractState === 'valid' ? 'success' : contractState === 'invalid' ? 'error' : 'info'}>
                          {contractState}
                        </Badge>
                        <Button size="sm" onClick={() => void saveContract()}>
                          Save contract
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CodeEditor
                        language="json"
                        value={contractText}
                        onChange={(value) => {
                          setContractText(value)
                          setContractState('editing')
                        }}
                        height="420px"
                      />
                    </CardContent>
                  </Card>
                </div>

                <aside className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Version History</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <p className="font-semibold text-text">v1.2 (Current)</p>
                        <p className="text-xs text-muted">Added role enum</p>
                        <p className="text-[11px] text-muted">Just now • By You</p>
                      </div>
                      <div className="opacity-70">
                        <p className="font-semibold text-text">v1.1</p>
                        <p className="text-xs text-muted">Initial Draft</p>
                        <p className="text-[11px] text-muted">2 hours ago • Alex M.</p>
                      </div>
                      <Button className="w-full" size="sm" variant="secondary" onClick={() => void openHistoryPanel()}>
                        View full history
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Contract Health</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {contractHealth.map((metric) => (
                        <div key={metric.label}>
                          <div className="mb-1 flex items-center justify-between text-xs text-muted">
                            <span>{metric.label}</span>
                            <span className="font-semibold text-text">{metric.value}</span>
                          </div>
                          <div className="h-2 rounded-full bg-surface-inset">
                            <div className="h-2 rounded-full bg-primary" style={{ width: `${metric.progress}%` }} />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Autocomplete Context</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs">
                      <div>
                        <p className="mb-1 font-semibold uppercase tracking-wide text-muted">request paths</p>
                        <div className="flex flex-wrap gap-1">
                          {completionProvider.fieldSuggestions('request.params', 6).map((item) => (
                            <span key={`request-${item}`} className="rounded-md border border-border bg-surface-soft px-2 py-1 font-mono text-[11px]">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 font-semibold uppercase tracking-wide text-muted">source paths</p>
                        <div className="flex flex-wrap gap-1">
                          {completionProvider.fieldSuggestions('source.', 6).map((item) => (
                            <span key={`source-${item}`} className="rounded-md border border-border bg-surface-soft px-2 py-1 font-mono text-[11px]">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Alert tone="info">Documentation: scenario authoring uses WHEN expr, RESPONSE JSON, and MUTATIONS mapping aligned to runtime.</Alert>
                  {autocompleteNotice ? <Alert tone="warning">{autocompleteNotice}</Alert> : null}
                </aside>
              </div>
                ) : null}

                {hasSelectedEndpoint && endpointTab === 'scenarios' ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
                <ScenarioSidebar
                  drafts={scenarioDrafts}
                  diagnostics={scenarioDiagnostics}
                  selectedScenarioId={selectedScenarioId}
                  onSelect={selectScenario}
                  onAdd={createScenario}
                  onDuplicate={duplicateSelectedScenario}
                  onDelete={deleteScenarioItem}
                  onMove={moveScenarioItem}
                  onSetFallback={setScenarioAsFallback}
                  onUnsetFallback={unsetScenarioFallback}
                />

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex w-full flex-wrap items-center justify-between gap-2">
                        <CardTitle>Scenario Editor</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant={scenarioState === 'ready' ? 'success' : scenarioState === 'error' ? 'error' : 'info'}>
                            {scenarioState}
                          </Badge>
                          <Button size="sm" variant="secondary" onClick={() => void saveScenarios()}>
                            Save Scenarios
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {scenarioDiagnostics.length > 0 ? (
                        <Alert tone="error">
                          <div className="space-y-1">
                            <p className="font-semibold">Blocking diagnostics</p>
                            {scenarioDiagnostics.slice(0, 6).map((item, index) => (
                              <p key={`${item.code}-${item.field}-${index}`} className="text-xs">
                                [{item.field}] {item.message}
                              </p>
                            ))}
                          </div>
                        </Alert>
                      ) : null}

                      {selectedScenario ? (
                        <>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                            <Input
                              value={selectedScenario.name}
                              placeholder="Scenario name"
                              onChange={(event) =>
                                updateSelectedScenario((item) => ({
                                  ...item,
                                  name: event.target.value,
                                }))
                              }
                            />
                            <Input value={String(selectedScenario.priority)} readOnly />
                          </div>

                          <ScenarioWhenSection
                            scenario={selectedScenario}
                            completionProvider={completionProvider}
                            onMount={onWhenEditorMount}
                            onChange={(value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                whenExpr: value,
                              }))
                            }
                          />

                          <ScenarioResponseSection
                            scenario={selectedScenario}
                            onStatusCodeChange={(value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  statusCode: value,
                                },
                              }))
                            }
                            onDelayMsChange={(value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  delayMs: value,
                                },
                              }))
                            }
                            onBodyJsonChange={(value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  bodyJson: value,
                                },
                              }))
                            }
                            onHeadersModeChange={(mode) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  headersMode: mode,
                                  headersJson: mode === 'advanced' ? JSON.stringify(headersFromPairs(item.response.headers), null, 2) : item.response.headersJson,
                                },
                              }))
                            }
                            onHeadersJsonChange={(value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  headersJson: value,
                                },
                              }))
                            }
                            onHeaderChange={(headerId, field, value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  headers: item.response.headers.map((header) =>
                                    header.id === headerId
                                      ? {
                                          ...header,
                                          [field]: value,
                                        }
                                      : header
                                  ),
                                },
                              }))
                            }
                            onAddHeader={() =>
                              updateSelectedScenario((item) => addHeader(item))
                            }
                            onRemoveHeader={(headerId) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                response: {
                                  ...item.response,
                                  headers:
                                    item.response.headers.length <= 1
                                      ? item.response.headers
                                      : item.response.headers.filter((header) => header.id !== headerId),
                                },
                              }))
                            }
                            onApplyHeadersJsonToSimple={applyHeadersJsonToSimpleMode}
                            onUseBodyTemplate={useCommonBodyTemplate}
                            onFormatBodyJson={formatSelectedBodyJSON}
                          />

                          <ScenarioMutationsTable
                            scenario={selectedScenario}
                            sourceSlugs={sourceSlugs}
                            onExprMount={onExprEditorMount}
                            onAddMutation={() => updateSelectedScenario((item) => addMutation(item))}
                            onRemoveMutation={(mutationId) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                mutations: item.mutations.filter((mutation) => mutation.id !== mutationId),
                              }))
                            }
                            onMutationTypeChange={(mutationId, value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                mutations: item.mutations.map((mutation) =>
                                  mutation.id === mutationId
                                    ? {
                                        ...mutation,
                                        type: value,
                                      }
                                    : mutation
                                ),
                              }))
                            }
                            onMutationSourceSlugChange={(mutationId, value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                mutations: item.mutations.map((mutation) =>
                                  mutation.id === mutationId
                                    ? {
                                        ...mutation,
                                        sourceSlug: value,
                                      }
                                    : mutation
                                ),
                              }))
                            }
                            onMutationEntityExprChange={(mutationId, value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                mutations: item.mutations.map((mutation) =>
                                  mutation.id === mutationId
                                    ? {
                                        ...mutation,
                                        entityIdExpr: value,
                                      }
                                    : mutation
                                ),
                              }))
                            }
                            onMutationPayloadExprChange={(mutationId, value) =>
                              updateSelectedScenario((item) => ({
                                ...item,
                                mutations: item.mutations.map((mutation) =>
                                  mutation.id === mutationId
                                    ? {
                                        ...mutation,
                                        payloadExpr: value,
                                      }
                                    : mutation
                                ),
                              }))
                            }
                          />
                        </>
                      ) : (
                        <Alert tone="info">Create a scenario to start authoring rules.</Alert>
                      )}

                      {autocompleteNotice ? <Alert tone="warning">{autocompleteNotice}</Alert> : null}
                    </CardContent>
                  </Card>
                </div>

                <ScenarioPreviewPanel
                  selectedScenarioId={selectedScenario?.id ?? 'global'}
                  selectedScenarioName={selectedScenario?.name ?? 'Scenario'}
                  compiledScenario={selectedScenarioCompilation?.scenario ?? null}
                  diagnostics={scenarioDiagnostics}
                />
              </div>
                ) : null}

                {hasSelectedEndpoint && endpointTab === 'traffic' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-soft px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={trafficState === 'error' ? 'error' : trafficState === 'streaming' ? 'success' : 'warning'}>
                      {trafficState === 'error' ? 'error' : trafficState === 'streaming' ? 'streaming live' : 'paused'}
                    </Badge>
                    <span className="text-sm text-muted">
                      Listening on <span className="font-mono text-primary">ws://api.mockengine.io/v1/stream</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={toggleTrafficPause}>
                      {trafficPollingPaused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={triggerTrafficRefresh}>
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTrafficEvents([])
                        setSelectedTrafficId('')
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                {trafficState === 'error' ? <Alert tone="error">{error || qaFixtures.trafficErrorMessage}</Alert> : null}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <Card>
                    <CardHeader>
                      <CardTitle>Event Stream</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-[110px_minmax(0,1fr)_110px_170px] gap-3 rounded-lg border border-border bg-surface-soft px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        <span>Time</span>
                        <span>Method / Path</span>
                        <span>Status</span>
                        <span>Scenario</span>
                      </div>

                      {(trafficEvents.length === 0 ? [null] : trafficEvents).map((event, index) => {
                        if (!event) {
                          return (
                            <div key="empty-traffic" className="rounded-lg border border-border bg-surface-soft px-3 py-4 text-sm text-muted">
                              No traffic yet.
                            </div>
                          )
                        }

                        const summary = parseTrafficSummary(event)
                        return (
                          <button
                            key={event.id || `traffic-${index}`}
                            className={`grid w-full grid-cols-[110px_minmax(0,1fr)_110px_170px] items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                              selectedTrafficId === event.id ? 'border-primary bg-primary/10' : 'border-border bg-surface-raised hover:bg-surface-soft'
                            }`}
                            onClick={() => setSelectedTrafficId(event.id)}
                            type="button"
                          >
                            <span className="font-mono text-xs text-muted">{event.createdAt}</span>
                            <span className="min-w-0 truncate">
                              <span className="mr-2 rounded-md bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success-dark">{summary.method}</span>
                              <span className="font-mono text-xs text-text">{summary.path}</span>
                            </span>
                            <span className="text-xs text-muted">{summary.status}</span>
                            <span className="truncate text-xs text-muted">{summary.scenario}</span>
                          </button>
                        )
                      })}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Request Details</CardTitle>
                      <Badge variant="neutral">{qaFixtures.trafficDetail.requestId}</Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-lg border border-border bg-surface-soft p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted">Request URL:</span>
                          <span className="font-mono text-xs text-text">{qaFixtures.trafficDetail.requestUrl}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-muted">Method:</span>
                          <span className="text-xs font-semibold text-success-dark">{qaFixtures.trafficDetail.method}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-muted">Client IP:</span>
                          <span className="font-mono text-xs text-text">{qaFixtures.trafficDetail.clientIp}</span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-surface-soft p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Headers</p>
                        <div className="space-y-1 text-xs font-mono">
                          {qaFixtures.trafficDetail.headers.map((header) => (
                            <p key={header.key}>
                              <span className="text-primary">{header.key}:</span> {header.value}
                            </p>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border bg-surface-soft p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Body</p>
                          <Badge variant="neutral">JSON</Badge>
                        </div>
                        <pre className="overflow-x-auto rounded-md border border-border bg-surface-inset p-3 text-xs font-mono text-text">
                          {qaFixtures.trafficDetail.bodyJson}
                        </pre>
                      </div>

                      <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-primary">Match Analysis</p>
                        <p className="text-xs text-muted">
                          Matched against <strong className="text-text">{selectedTrafficSummary.scenario}</strong> based on:
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {qaFixtures.trafficDetail.matchedBy.map((rule) => (
                            <span key={rule} className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[10px] font-mono text-muted">
                              {rule}
                            </span>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
                ) : null}
              </div>

              {error && endpointTab !== 'traffic' ? <Alert className="mt-4" tone="error">{error}</Alert> : null}
            </div>
          </div>
        </div>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <Card className="w-full max-w-[860px]">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Endpoint Revision History</CardTitle>
                <IconActionButton
                  label="Close endpoint revision history"
                  icon={<X className="h-4 w-4" aria-hidden />}
                  onClick={() => setHistoryOpen(false)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingRevisions ? <p className="text-sm text-muted">Loading revisions...</p> : null}
              {!loadingRevisions && revisions.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface-soft p-3 text-sm text-muted">No revisions found yet.</p>
              ) : null}
              {!loadingRevisions && revisions.length > 0 ? (
                <div className="max-h-[420px] space-y-2 overflow-auto">
                  {revisions.map((revision) => (
                    <div key={revision.id} className="rounded-xl border border-border bg-surface-soft p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs text-text">{revision.id}</p>
                          <p className="text-xs text-muted">{revision.createdAt}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {revision.restoredFromRevisionId ? <Badge variant="info">restored</Badge> : <Badge variant="neutral">saved</Badge>}
                          <Button size="sm" variant="secondary" onClick={() => void restoreRevisionByID(revision.id)}>
                            Restore
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {revisionsCursor ? (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!token || integrationId === '' || packId === '' || !hasSelectedEndpoint) {
                        return
                      }
                      try {
                        setLoadingRevisions(true)
                        const result = await getEndpointRevisions(
                          token,
                          integrationId,
                          selectedEndpointId,
                          { limit: 20, cursor: revisionsCursor },
                          packId
                        )
                        setRevisions((current) => [...current, ...result.items])
                        setRevisionsCursor(result.nextCursor)
                      } catch (requestError) {
                        setError(formatAPIError(requestError))
                      } finally {
                        setLoadingRevisions(false)
                      }
                    }}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <NewEndpointModal
        basePath={resolvedPackBasePath}
        error={createEndpointError}
        finalPathPreview={createEndpointFinalPathPreview}
        isOpen={isCreateEndpointModalOpen}
        method={createEndpointMethod}
        relativePath={createEndpointRelativePath}
        requestBodyExample={createEndpointRequestBodyExample}
        submitting={createEndpointSubmitting}
        onClose={closeCreateEndpointModal}
        onMethodChange={setCreateEndpointMethod}
        onRelativePathChange={setCreateEndpointRelativePath}
        onRequestBodyExampleChange={setCreateEndpointRequestBodyExample}
        onSubmit={() => void createEndpointFromModal()}
      />
    </section>
  )
}

function fixtureToEndpointScenario(scenario: {
  name: string
  priority: number
  conditionExpr: string
  responseStatusCode: number
  responseLatencyMs: number
  contentType: string
  responseBodyJson: string
}): EndpointScenario {
  const body = tryParseJSON(scenario.responseBodyJson)
  return {
    name: scenario.name,
    priority: scenario.priority,
    conditionExpr: scenario.conditionExpr,
    response: {
      statusCode: scenario.responseStatusCode,
      delayMs: scenario.responseLatencyMs,
      headers: {
        'Content-Type': scenario.contentType,
      },
      body: isObject(body) ? body : { value: body ?? null },
    },
  }
}

function isEditableParamScope(value: string): value is EditableContractParamScope {
  return EDITABLE_PARAM_SCOPE_OPTIONS.includes(value as EditableContractParamScope)
}

function toOpenAPIPath(value: string): string {
  return value.replace(/:([a-zA-Z0-9_]+)/g, '{$1}')
}

function normalizePathForComparison(path: string): string {
  const serialized = serializePathTemplate(tokenizePathTemplate(normalizeEndpointPathInput(path)))
  const trimmed = serialized.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function prettyPrintJSON(value: string): string {
  const parsed = tryParseJSON(value)
  if (parsed === null) {
    return value
  }
  return JSON.stringify(parsed, null, 2)
}

function tryParseJSON(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tabForQAState(state: NonNullable<ReturnType<typeof parseBundleCQAState>>): EndpointTab {
  if (state === 'contract-ready') {
    return 'contract'
  }

  if (state === 'scenarios-editing') {
    return 'scenarios'
  }

  return 'traffic'
}

function preferredScenarioSelectionID(drafts: ScenarioDraft[]): string {
  if (drafts.length === 0) {
    return ''
  }
  const editable = drafts.find((item) => !item.fallback)
  return editable?.id ?? drafts[0]?.id ?? ''
}

function enrichAutocompleteContext(
  runtimeContext: AutocompleteContext | null | undefined,
  sourceSlugs: string[],
  sourcePathsFromSchema: string[] = []
): AutocompleteContext | null {
  const sourceRoots = sourceSlugs
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => `source.${item}`)
  const sourcePaths = uniqueStrings([...sourceRoots, ...sourcePathsFromSchema])

  if (!runtimeContext) {
    if (sourcePaths.length === 0) {
      return null
    }

    return {
      requestPaths: [],
      sourcePaths,
      functions: [],
      templatePaths: [],
    }
  }

  return {
    ...runtimeContext,
    requestPaths: uniqueStrings(runtimeContext.requestPaths),
    sourcePaths: uniqueStrings([...runtimeContext.sourcePaths, ...sourcePaths]),
  }
}

function buildSourceAssistFromSchemas(
  sources: Array<{ id: string; slug: string }>,
  schemaResults: PromiseSettledResult<{ fields: Array<{ key: string; effectiveType: string }> }>[] = []
): { paths: string[]; types: Record<string, string> } {
  const paths: string[] = []
  const types: Record<string, string> = {}

  sources.forEach((item, index) => {
    const slug = item.slug.trim()
    if (slug === '') {
      return
    }
    paths.push(`source.${slug}`)

    const result = schemaResults[index]
    if (!result || result.status !== 'fulfilled') {
      return
    }

    result.value.fields.forEach((field) => {
      const key = field.key.trim()
      if (key === '') {
        return
      }
      const path = `source.${slug}.${key}`
      paths.push(path)
      types[path] = field.effectiveType
    })
  })

  return {
    paths: uniqueStrings(paths),
    types,
  }
}

function extractRequestFieldTypes(contractJSON: string): Record<string, string> {
  const parsed = tryParseJSON(contractJSON)
  if (!isObject(parsed)) {
    return {}
  }

  const properties = isObject(parsed.properties) ? parsed.properties : null
  if (!properties) {
    return {}
  }

  const result: Record<string, string> = {
    'request.method': 'string',
    'request.path': 'string',
  }

  const body = properties.body
  if (isObject(body)) {
    collectSchemaFieldTypes(body, 'request.params.body', result)
  }

  const query = properties.query
  if (isObject(query)) {
    collectSchemaFieldTypes(query, 'request.params.query', result)
  }

  const header = properties.header
  if (isObject(header)) {
    collectSchemaFieldTypes(header, 'request.params.headers', result)
  }

  const headers = properties.headers
  if (isObject(headers)) {
    collectSchemaFieldTypes(headers, 'request.params.headers', result)
  }

  return result
}

function collectSchemaFieldTypes(schemaNode: Record<string, unknown>, prefix: string, out: Record<string, string>): void {
  const nodeType = schemaType(schemaNode.type)
  if (nodeType && prefix !== 'request.params.body' && prefix !== 'request.params.query' && prefix !== 'request.params.headers') {
    out[prefix] = nodeType
  }

  const properties = isObject(schemaNode.properties) ? schemaNode.properties : null
  if (properties) {
    Object.entries(properties).forEach(([key, value]) => {
      if (!isObject(value)) {
        return
      }
      const nextPrefix = `${prefix}.${key}`
      const childType = schemaType(value.type)
      if (childType) {
        out[nextPrefix] = childType
      }
      collectSchemaFieldTypes(value, nextPrefix, out)
    })
  }

  const items = isObject(schemaNode.items) ? schemaNode.items : null
  if (items) {
    const itemType = schemaType(items.type)
    if (itemType) {
      out[prefix] = 'array'
      out[`${prefix}.item`] = itemType
    }
    collectSchemaFieldTypes(items, `${prefix}.item`, out)
  }
}

function schemaType(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim().toLowerCase()
  }
  if (Array.isArray(raw)) {
    const first = raw.find((item): item is string => typeof item === 'string' && item.trim() !== '')
    return first ? first.trim().toLowerCase() : null
  }
  return null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter((item) => item !== ''))]
}

function defaultPrebuiltAuthPolicy(): {
  denyAll: boolean
  tokenEquals?: string
  emailEquals?: string
  emailContains?: string
  emailInList?: string[]
  requiredHeaders?: Array<{ name: string; operator: 'EXISTS' | 'EQUALS' | 'CONTAINS'; value?: string }>
  oidc?: { issuer?: string; jwksUrl?: string; audience?: string; emailClaim?: string }
} {
  return {
    denyAll: false,
    emailInList: [],
    requiredHeaders: [],
  }
}

function extractCustomAuthExpr(rawPolicyJSON: string): string {
  const parsed = tryParseJSON(rawPolicyJSON)
  if (!isObject(parsed)) {
    return "auth.email == 'dev@example.com'"
  }
  const mode = typeof parsed.mode === 'string' ? parsed.mode.toUpperCase() : ''
  const customExpr = typeof parsed.customExpr === 'string' ? parsed.customExpr.trim() : ''
  if (mode === 'CUSTOM_EXPR' && customExpr !== '') {
    return customExpr
  }
  return "auth.email == 'dev@example.com'"
}

function formatEndpointTitle(method: string, path: string): string {
  const normalizedPath = path.split('/').filter((segment) => segment !== '' && !segment.startsWith('{'))
  const resource = normalizedPath[normalizedPath.length - 1] || 'Endpoint'
  return `${method.toUpperCase()} ${capitalize(resource)} Endpoint`
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function parseTrafficSummary(event: TrafficEvent | null): TrafficSummary {
  if (!event) {
    return {
      method: 'GET',
      path: '/no-traffic',
      status: 'No data',
      scenario: 'No scenario',
    }
  }

  const parsed = tryParseJSON(event.requestSummaryJson)
  if (!isObject(parsed)) {
    return {
      method: 'GET',
      path: event.requestSummaryJson,
      status: 'Unknown',
      scenario: event.matchedScenario || 'Unknown',
    }
  }

  const method = typeof parsed.method === 'string' ? parsed.method : 'GET'
  const path = typeof parsed.path === 'string' ? parsed.path : event.requestSummaryJson
  const status = typeof parsed.status === 'string' ? parsed.status : 'Unknown'
  const scenario = typeof parsed.scenario === 'string' ? parsed.scenario : event.matchedScenario || 'Unknown'

  return {
    method,
    path,
    status,
    scenario,
  }
}
