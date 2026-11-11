import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type ArtifactBundle,
  type ArtifactProjectSummary,
  type ArtifactTemplate,
  type PreviewResult,
  strategyArtifactClient,
} from '@/lib/trader/strategyArtifactClient'
import {
  type ExperimentJob,
  type ExperimentJobSummary,
  experimentClient,
} from '@/lib/trader/experimentClient'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { useTraderData } from '@/lib/trader/useTraderData'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const editorClass =
  'min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring'

function blankRulesDocument(kind: 'indicator' | 'strategy') {
  return {
    format: 'chartly-rules-v1',
    kind,
    inputs: [
      { name: 'length', type: 'integer', default: '14', min: '2', max: '500', unit: 'bars' },
      { name: 'source', type: 'source', default: 'close' },
    ],
    outputs: [{ name: 'value', plot: 'line' }],
    policy: { warmupBars: 14, barCloseOnly: true, missingData: 'skip-bar' },
    rules: [{ op: 'sma', input: 'source', length: 'length', output: 'value' }],
  }
}

/** Deterministic down-then-up series used only as an engine smoke check. */
function syntheticCandles() {
  const closes: number[] = []
  for (let i = 0; i < 20; i += 1) closes.push(100 - i)
  for (let i = 1; i <= 20; i += 1) closes.push(80 + i)
  return closes.map((value, index) => ({
    time: `2026-01-01T00:${String(index).padStart(2, '0')}:00Z`,
    open: String(value),
    high: String(value),
    low: String(value),
    close: String(value),
    volume: '100',
  }))
}

function sourceToText(language: string, source: unknown): string {
  return language === 'chartly-rules-v1'
    ? JSON.stringify(source, null, 2)
    : typeof source === 'string'
      ? source
      : ''
}

export default function StrategyWorkspace() {
  const data = useTraderData()
  const principal = useAuthStore(chartStorageAccount)
  const originId = data.workspace?.originId
  const ready = !!(principal && originId && data.storageMode === 'backend')
  const ownerKey = `${principal ?? ''}:${originId ?? ''}`
  const epoch = useRef(0)
  const listEpoch = useRef(0)

  const [projects, setProjects] = useState<ArtifactProjectSummary[]>([])
  const [templates, setTemplates] = useState<ArtifactTemplate[]>([])
  const [bundle, setBundle] = useState<ArtifactBundle | null>(null)
  const [editorText, setEditorText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'indicator' | 'strategy'>('indicator')
  const [newTemplate, setNewTemplate] = useState('')
  const [chartDocumentId, setChartDocumentId] = useState('')
  const [packageText, setPackageText] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [jobs, setJobs] = useState<ExperimentJobSummary[]>([])
  const [selectedJob, setSelectedJob] = useState<ExperimentJob | null>(null)
  const [exp, setExp] = useState({
    datasetVersionId: '',
    instrumentId: '',
    warmupStart: '',
    rangeStart: '',
    rangeEnd: '',
    cash: '10000',
    currency: 'USD',
    feeBps: '10',
    slippageBps: '0',
    fraction: '1',
    quantityStep: '0.00000001',
    quantityScale: '8',
    entryOutput: 'entry',
    exitOutput: 'exit',
    seed: '1',
  })

  const loadList = useCallback(async () => {
    if (!originId || !principal) return
    const ticket = ++listEpoch.current
    try {
      const [listed, templated] = await Promise.all([
        strategyArtifactClient.list(originId, undefined, principal),
        strategyArtifactClient.templates(undefined, principal),
      ])
      if (listEpoch.current !== ticket) return
      setProjects(listed.projects)
      setTemplates(templated.templates)
    } catch (cause) {
      if (listEpoch.current === ticket)
        setError(cause instanceof Error ? cause.message : 'Projects could not be loaded.')
    }
  }, [originId, principal])

  const loadJobs = useCallback(async () => {
    if (!originId || !principal) return
    try {
      const listed = await experimentClient.list(originId, principal)
      setJobs(listed.jobs)
    } catch {
      /* Job list refresh failure is surfaced on explicit experiment actions. */
    }
  }, [originId, principal])

  async function submitExperiment() {
    if (!originId || !principal || !bundle) return
    const revision = bundle.revisions[bundle.revisions.length - 1]
    const params = revision
      ? bundle.parameterSets.find((row) => row.artifactRevisionId === revision.id)
      : undefined
    if (!revision || !params) {
      setError('Create a revision first — experiments pin an exact revision and parameter set.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await experimentClient.submit(
        originId,
        {
          requestId: `experiment_${crypto.randomUUID().replaceAll('-', '')}`,
          projectId: bundle.id,
          revisionId: revision.id,
          parameterSetId: params.id,
          datasetVersionId: exp.datasetVersionId.trim(),
          instrumentId: exp.instrumentId.trim(),
          warmupStart: exp.warmupStart.trim(),
          rangeStart: exp.rangeStart.trim(),
          rangeEnd: exp.rangeEnd.trim(),
          startingCash: { value: exp.cash.trim(), currency: exp.currency.trim() },
          feeBps: exp.feeBps.trim(),
          slippageBps: exp.slippageBps.trim(),
          fraction: exp.fraction.trim(),
          quantityStep: exp.quantityStep.trim(),
          quantityScale: Number(exp.quantityScale),
          entryOutput: exp.entryOutput.trim(),
          exitOutput: exp.exitOutput.trim(),
          seed: Number(exp.seed),
        },
        principal
      )
      setSelectedJob(result.job)
      setNotice('Experiment submitted. Run it explicitly — nothing runs in the background.')
      await loadJobs()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Experiment could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  async function runNextJob() {
    if (!originId || !principal) return
    setBusy(true)
    setError('')
    try {
      const result = await experimentClient.runNext(originId, principal)
      if (result.job) setSelectedJob(result.job)
      else setNotice('No queued experiment to run.')
      await loadJobs()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Experiment could not be run.')
    } finally {
      setBusy(false)
    }
  }

  async function openJob(id: string) {
    if (!originId || !principal) return
    try {
      const result = await experimentClient.detail(originId, id, principal)
      setSelectedJob(result.job)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Experiment could not be opened.')
    }
  }

  async function cancelJob(id: string) {
    if (!originId || !principal) return
    try {
      const result = await experimentClient.cancel(originId, id, principal)
      setSelectedJob(result.job)
      await loadJobs()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Experiment could not be cancelled.')
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Owner identity is the workspace privacy boundary; switching it must discard the open project.
  useEffect(() => {
    epoch.current += 1
    listEpoch.current += 1
    setBundle(null)
    setEditorText('')
    setPreview(null)
    setConflict(false)
    setSelectedJob(null)
    if (ready) {
      void loadList()
      void loadJobs()
    }
  }, [ownerKey, ready, loadList, loadJobs])

  async function openProject(id: string) {
    if (!originId || !principal) return
    const ticket = ++epoch.current
    setBusy(true)
    setError('')
    try {
      const result = await strategyArtifactClient.detail(originId, id, undefined, principal)
      if (epoch.current !== ticket) return
      setBundle(result.project)
      setEditorText(sourceToText(result.project.project.language, result.project.draft.source))
      setPreview(null)
      setConflict(false)
    } catch (cause) {
      if (epoch.current === ticket)
        setError(cause instanceof Error ? cause.message : 'Project could not be opened.')
    } finally {
      if (epoch.current === ticket) setBusy(false)
    }
  }

  async function act(
    name: Parameters<typeof strategyArtifactClient.action>[0]['action'],
    payload: Record<string, unknown>,
    project: ArtifactBundle | null = bundle,
    draftRevision?: number
  ) {
    if (!originId || !principal) return null
    const ticket = ++epoch.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await strategyArtifactClient.action(
        {
          originId,
          ...(project ? { projectId: project.id } : {}),
          expectedRevision: project?.revision ?? 0,
          ...(draftRevision !== undefined ? { expectedDraftRevision: draftRevision } : {}),
          action: name,
          payload,
        },
        undefined,
        principal
      )
      if (epoch.current !== ticket) return null
      if (result.project) {
        setBundle(result.project)
        if (name !== 'save-draft')
          setEditorText(sourceToText(result.project.project.language, result.project.draft.source))
      }
      await loadList()
      return result
    } catch (cause) {
      if (epoch.current !== ticket) return null
      if (cause instanceof LocalStorageError && cause.code === 'artifact.draft_conflict') {
        setConflict(true)
        setError(
          'This draft changed elsewhere. Your editor text below is unchanged — reload the saved draft to compare, or keep editing and reload before saving.'
        )
      } else {
        setError(cause instanceof Error ? cause.message : 'The change could not be saved.')
      }
      return null
    } finally {
      if (epoch.current === ticket) setBusy(false)
    }
  }

  function parsedSource(): unknown {
    if (!bundle) return null
    if (bundle.project.language === 'chartly-rules-v1') {
      try {
        return JSON.parse(editorText)
      } catch {
        setError('The rules document is not valid JSON yet. Fix the syntax to save; your text is retained.')
        return null
      }
    }
    return editorText
  }

  async function saveDraft() {
    if (!bundle) return
    const source = parsedSource()
    if (source === null) return
    const result = await act('save-draft', { source }, bundle, bundle.draft.draftRevision)
    if (result?.project) {
      setConflict(false)
      setNotice(
        result.project.draft.diagnostics.length
          ? `Draft saved with diagnostics: ${result.project.draft.diagnostics.join(', ')}`
          : 'Draft saved.'
      )
    }
  }

  async function createProject() {
    if (newTemplate) {
      const result = await act('create-from-template', { templateId: newTemplate }, null)
      if (result?.project) setNotice('Project created from template.')
      return
    }
    if (!newName.trim()) return
    const result = await act(
      'create',
      {
        name: newName.trim(),
        kind: newKind,
        language: 'chartly-rules-v1',
        source: blankRulesDocument(newKind),
      },
      null
    )
    if (result?.project) {
      setNewName('')
      setNotice('Project created. Edit the draft, save, then create a revision.')
    }
  }

  async function runPreview() {
    if (!bundle) return
    const revision = bundle.revisions[bundle.revisions.length - 1]
    const params = revision
      ? bundle.parameterSets.find((row) => row.artifactRevisionId === revision.id)
      : undefined
    if (!revision || !params) {
      setError('Create a revision first — preview always runs an exact saved revision and parameter set.')
      return
    }
    const result = await act(
      'preview',
      { revisionId: revision.id, parameterSetId: params.id, candles: syntheticCandles() },
      bundle
    )
    if (result && 'rows' in result && result.rows) setPreview(result as PreviewResult)
  }

  async function exportProject() {
    if (!bundle) return
    const result = await act('export', {}, bundle)
    if (result?.package) setPackageText(JSON.stringify(result.package, null, 2))
  }

  async function importProject() {
    let parsed: unknown
    try {
      parsed = JSON.parse(packageText)
    } catch {
      setError('Paste a complete exported package JSON to import.')
      return
    }
    const result = await act('import', { package: parsed }, null)
    if (result?.project) setNotice('Package imported as a new project with fresh identities.')
  }

  const latestRevision = bundle?.revisions[bundle.revisions.length - 1]
  const archived = bundle?.project.state === 'archived'

  return (
    <div className="space-y-6 py-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Strategy Builder</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Create indicators and strategies as versioned projects. Drafts may be incomplete;
          only validated revisions can be previewed, attached or tested. Applying an
          indicator to a chart never places or arms an order.
        </p>
      </header>
      {!ready ? (
        <section className="max-w-3xl space-y-3 border bg-card p-6">
          <h2 className="text-lg font-semibold">Local workspace required</h2>
          <p className="text-sm text-muted-foreground">
            Sign in and open the backend workspace to save strategy projects. Nothing is
            stored in the browser alone.
          </p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New project</CardTitle>
                <CardDescription>Start from a template or a blank rules document.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="sb-template">Template</Label>
                  <select
                    id="sb-template"
                    className={fieldClass}
                    value={newTemplate}
                    onChange={(event) => setNewTemplate(event.target.value)}
                  >
                    <option value="">Blank project</option>
                    {templates.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.kind})
                      </option>
                    ))}
                  </select>
                </div>
                {!newTemplate && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="sb-name">Name</Label>
                      <Input
                        id="sb-name"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sb-kind">Kind</Label>
                      <select
                        id="sb-kind"
                        className={fieldClass}
                        value={newKind}
                        onChange={(event) =>
                          setNewKind(event.target.value as 'indicator' | 'strategy')
                        }
                      >
                        <option value="indicator">Indicator</option>
                        <option value="strategy">Strategy</option>
                      </select>
                    </div>
                  </>
                )}
                <Button disabled={busy || (!newTemplate && !newName.trim())} onClick={() => void createProject()}>
                  Create project
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {projects.length === 0 && (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                )}
                {projects.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="block w-full border p-3 text-left text-sm hover:bg-muted"
                    onClick={() => void openProject(row.id)}
                  >
                    <span className="font-medium">{row.name}</span>{' '}
                    <Badge variant="outline">{row.kind}</Badge>{' '}
                    <span className="text-muted-foreground">
                      {row.revisionCount} revision{row.revisionCount === 1 ? '' : 's'}
                      {row.state === 'archived' ? ' · archived' : ''}
                      {row.diagnostics.length ? ` · ${row.diagnostics.length} diagnostics` : ''}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            {error && (
              <output role="alert" className="block border p-3 text-sm">
                {error}
              </output>
            )}
            {notice && <output className="block border p-3 text-sm">{notice}</output>}
            {!bundle ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Create or open a project to edit its draft.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{bundle.project.name}</CardTitle>
                    <CardDescription>
                      {bundle.project.kind} · {bundle.project.language} · draft #
                      {bundle.draft.draftRevision}
                      {bundle.draft.baseRevisionId
                        ? ' · based on a saved revision'
                        : ' · no revision yet'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Label htmlFor="sb-editor">
                      {bundle.project.language === 'chartly-rules-v1'
                        ? 'Rules document (JSON)'
                        : 'Source code (code-only; no lossy conversion is attempted)'}
                    </Label>
                    <textarea
                      id="sb-editor"
                      className={editorClass}
                      value={editorText}
                      disabled={archived}
                      onChange={(event) => setEditorText(event.target.value)}
                      spellCheck={false}
                    />
                    {bundle.draft.diagnostics.length > 0 && (
                      <p className="text-sm">
                        Diagnostics: {bundle.draft.diagnostics.join(', ')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy || archived} onClick={() => void saveDraft()}>
                        Save draft
                      </Button>
                      {conflict && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void openProject(bundle.id)}
                        >
                          Reload saved draft
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy || archived}
                        onClick={() => void act('create-revision', {}, bundle)}
                      >
                        Create revision
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void act('clone', {}, bundle)}
                      >
                        Clone
                      </Button>
                      {!archived && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void act('archive', {}, bundle)}
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Revisions & parameters</CardTitle>
                    <CardDescription>
                      Revisions are immutable. Editing the draft never changes them.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {bundle.revisions.length === 0 && <p>No revisions yet.</p>}
                    {bundle.revisions.map((row) => (
                      <p key={row.id} className="border p-2 font-mono text-xs">
                        {row.id.slice(0, 24)}… · sha {row.checksum.slice(0, 12)}… · {row.createdAt}
                      </p>
                    ))}
                    {bundle.parameterSets.map((row) => (
                      <p key={row.id} className="border p-2 font-mono text-xs">
                        params ({row.origin}): {JSON.stringify(row.values)}
                      </p>
                    ))}
                    <div className="flex flex-wrap items-end gap-2 pt-2">
                      <div className="space-y-2">
                        <Label htmlFor="sb-chart-doc">Chart document ID (indicator attach)</Label>
                        <Input
                          id="sb-chart-doc"
                          value={chartDocumentId}
                          onChange={(event) => setChartDocumentId(event.target.value)}
                        />
                      </div>
                      <Button
                        variant="outline"
                        disabled={busy || !latestRevision || !chartDocumentId}
                        onClick={() => {
                          const params = bundle.parameterSets.find(
                            (row) => row.artifactRevisionId === latestRevision?.id
                          )
                          if (latestRevision && params)
                            void act(
                              'attach',
                              {
                                revisionId: latestRevision.id,
                                parameterSetId: params.id,
                                chartDocumentId,
                              },
                              bundle
                            )
                        }}
                      >
                        Apply to chart
                      </Button>
                    </div>
                    {bundle.attachments.map((row) => (
                      <p key={row.id} className="border p-2 font-mono text-xs">
                        attached: {row.chartDocumentId} → {row.artifactRevisionId.slice(0, 24)}…
                      </p>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Preview (engine check)</CardTitle>
                    <CardDescription>
                      Runs the latest saved revision on a labelled synthetic down-then-up series — not
                      market data. Pinned saved-data experiments arrive with P21.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <Button variant="outline" disabled={busy} onClick={() => void runPreview()}>
                      Run preview
                    </Button>
                    {preview && (
                      <div className="space-y-1 font-mono text-xs">
                        <p>plan {preview.planChecksum.slice(0, 12)}…</p>
                        {preview.rows.slice(-6).map((row) => (
                          <p key={row.time}>
                            {row.time} {JSON.stringify(row.outputs)}
                          </p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Experiments</CardTitle>
                    <CardDescription>
                      Saved-data tests of the latest revision with pinned dataset, costs and fill
                      assumptions. Results are research evidence — they cannot arm an account.
                      Indicators need trading rules (entry/exit outputs) before P&L testing.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(
                        [
                          ['datasetVersionId', 'Dataset version ID'],
                          ['instrumentId', 'Instrument ID'],
                          ['seed', 'Seed'],
                          ['warmupStart', 'Warmup start (UTC ISO)'],
                          ['rangeStart', 'Range start (UTC ISO)'],
                          ['rangeEnd', 'Range end (UTC ISO)'],
                          ['cash', 'Starting cash'],
                          ['currency', 'Currency'],
                          ['feeBps', 'Fee (bps)'],
                          ['slippageBps', 'Slippage (bps)'],
                          ['fraction', 'Equity fraction'],
                          ['quantityStep', 'Quantity step'],
                          ['quantityScale', 'Quantity scale'],
                          ['entryOutput', 'Entry output'],
                          ['exitOutput', 'Exit output'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="space-y-2">
                          <Label htmlFor={`sb-exp-${field}`}>{label}</Label>
                          <Input
                            id={`sb-exp-${field}`}
                            value={exp[field]}
                            onChange={(event) => setExp({ ...exp, [field]: event.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy || !exp.datasetVersionId || !exp.rangeStart}
                        onClick={() => void submitExperiment()}
                      >
                        Submit experiment
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => void runNextJob()}>
                        Run next queued
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => void loadJobs()}>
                        Refresh jobs
                      </Button>
                    </div>
                    {jobs.length === 0 && <p>No experiments submitted yet.</p>}
                    {jobs.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-2 border p-2">
                        <button
                          type="button"
                          className="font-mono text-xs underline"
                          onClick={() => void openJob(row.id)}
                        >
                          {row.id.slice(0, 24)}…
                        </button>
                        <Badge variant="outline">{row.status}</Badge>
                        <span className="text-muted-foreground">{row.updatedAt}</span>
                        {row.status === 'queued' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void cancelJob(row.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    ))}
                    {selectedJob?.report && (
                      <div className="space-y-1 border p-3">
                        <p>
                          Result: equity {selectedJob.report.endingEquity} · return{' '}
                          {selectedJob.report.totalReturn} · max drawdown{' '}
                          {selectedJob.report.maxDrawdown} · {selectedJob.report.tradeCount} trades
                        </p>
                        {selectedJob.report.trades.map((trade) => (
                          <p key={trade.entryTime} className="font-mono text-xs">
                            {trade.entryTime} → {trade.exitTime} · {trade.quantity} @{' '}
                            {trade.entryPrice} → {trade.exitPrice} · net {trade.netPnl}
                          </p>
                        ))}
                        {selectedJob.report.openPosition && (
                          <p className="font-mono text-xs">
                            open: {selectedJob.report.openPosition.quantity} @{' '}
                            {selectedJob.report.openPosition.entryPrice}
                          </p>
                        )}
                      </div>
                    )}
                    {selectedJob?.trial.failureCode && (
                      <p>Failure: {selectedJob.trial.failureCode}</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Export / import</CardTitle>
                    <CardDescription>
                      Packages are checksum-sealed and contain no secrets. Import always creates a
                      new project identity.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <textarea
                      aria-label="Artifact package JSON"
                      className={editorClass}
                      value={packageText}
                      onChange={(event) => setPackageText(event.target.value)}
                      spellCheck={false}
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={busy} onClick={() => void exportProject()}>
                        Export this project
                      </Button>
                      <Button variant="outline" disabled={busy || !packageText.trim()} onClick={() => void importProject()}>
                        Import package
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
