import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  CustomIndicatorError,
  type CustomIndicatorFile,
  customIndicatorsClient,
} from '@/api/customIndicators'
import { SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type IndicatorValidation,
  validateCustomIndicatorSource,
} from '@/lib/trading/validateCustomIndicator'

const SMA_TEMPLATE = `export default function ({ registerIndicator, sourceValues }) {
  registerIndicator({
    id: 'my-sma',
    name: 'My SMA',
    category: 'Custom',
    placement: 'onchart',
    inputs: [
      { key: 'length', type: 'number', label: 'Length', default: 20, min: 1, step: 1 },
      { key: 'source', type: 'source', label: 'Source', default: 'close' },
    ],
    plots: [
      { key: 'ma', type: 'line', title: 'MA', style: { color: '#4f8cff', lineWidth: 2 } },
    ],
    calc(bars, settings) {
      const src = sourceValues(bars, settings.source)
      const n = Math.max(1, Math.floor(Number(settings.length)) || 20)
      const ma = new Array(bars.length).fill(null)
      let sum = 0
      for (let i = 0; i < src.length; i++) {
        sum += src[i]
        if (i >= n) sum -= src[i - n]
        if (i >= n - 1) ma[i] = sum / n
      }
      return { ma }
    },
  })
}
`

const RSI_TEMPLATE = `export default function ({ registerIndicator, sourceValues }) {
  registerIndicator({
    id: 'my-rsi',
    name: 'My RSI',
    category: 'Custom',
    placement: 'pane',
    inputs: [
      { key: 'length', type: 'number', label: 'Length', default: 14, min: 1, step: 1 },
      { key: 'source', type: 'source', label: 'Source', default: 'close' },
    ],
    plots: [
      { key: 'rsi', type: 'line', title: 'RSI', style: { color: '#b39ddb', lineWidth: 2 } },
    ],
    levels: () => [
      { value: 70, label: '70' },
      { value: 30, label: '30' },
    ],
    range: () => ({ min: 0, max: 100 }),
    calc(bars, settings) {
      const src = sourceValues(bars, settings.source)
      const n = Math.max(1, Math.floor(Number(settings.length)) || 14)
      const rsi = new Array(bars.length).fill(null)
      let gain = 0
      let loss = 0
      for (let i = 1; i < src.length; i++) {
        const change = src[i] - src[i - 1]
        const up = Math.max(change, 0)
        const down = Math.max(-change, 0)
        if (i <= n) {
          gain += up / n
          loss += down / n
          if (i === n) rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
        } else {
          gain = (gain * (n - 1) + up) / n
          loss = (loss * (n - 1) + down) / n
          rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
        }
      }
      return { rsi }
    },
  })
}
`

const TEMPLATES = [
  { label: 'Moving average (overlay)', filename: 'my_sma.js', source: SMA_TEMPLATE },
  { label: 'RSI (own pane)', filename: 'my_rsi.js', source: RSI_TEMPLATE },
]

function messageOf(cause: unknown): string {
  if (cause instanceof CustomIndicatorError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export default function CustomIndicators() {
  const [files, setFiles] = useState<CustomIndicatorFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [source, setSource] = useState('')
  const [savedSource, setSavedSource] = useState('')
  const [validation, setValidation] = useState<IndicatorValidation | null>(null)
  const [validatedSource, setValidatedSource] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const requestSeq = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setFiles(await customIndicatorsClient.list())
    } catch (cause) {
      setStatus(messageOf(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dirty = source !== savedSource
  const validatedCurrent = validation?.ok === true && validatedSource === source

  function openDraft(nextFilename: string, nextSource: string, file: string | null) {
    setSelected(file)
    setFilename(nextFilename)
    setSource(nextSource)
    setSavedSource(file ? nextSource : '')
    setValidation(null)
    setValidatedSource(null)
    setConfirmDelete(false)
    setStatus(null)
  }

  async function openFile(file: string) {
    const seq = ++requestSeq.current
    try {
      const detail = await customIndicatorsClient.read(file)
      if (seq !== requestSeq.current) return
      openDraft(detail.file, detail.source, detail.file)
    } catch (cause) {
      setStatus(messageOf(cause))
    }
  }

  async function runValidation() {
    setBusy(true)
    setStatus(null)
    try {
      const result = await validateCustomIndicatorSource(source)
      setValidation(result)
      setValidatedSource(result.ok ? source : null)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setStatus(null)
    try {
      const saved = selected
        ? await customIndicatorsClient.update(selected, source)
        : await customIndicatorsClient.create(filename.trim(), source)
      setSelected(saved.file)
      setFilename(saved.file)
      setSavedSource(source)
      setStatus(
        `Saved ${saved.file}. Open a chart, then Indicators > Custom to put it on the chart — no restart needed.`
      )
      await refresh()
    } catch (cause) {
      setStatus(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selected) return
    setBusy(true)
    try {
      await customIndicatorsClient.remove(selected)
      setStatus(`Deleted ${selected}. A backup (${selected}.bak) stays in the folder.`)
      openDraft('', '', null)
      await refresh()
    } catch (cause) {
      setStatus(messageOf(cause))
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  async function downloadSkill() {
    try {
      await customIndicatorsClient.downloadSkill()
      setStatus(
        'Skill downloaded. Give the file to your LLM (Claude Code, Codex, Cursor or ChatGPT) and ask it to write your indicator, then paste the result here and Validate.'
      )
    } catch (cause) {
      setStatus(messageOf(cause))
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <header className="space-y-3">
        <SettingsBackLink />
        <div>
          <h1 className="text-2xl font-bold">Custom Indicators</h1>
          <p className="mt-1 text-muted-foreground">
            Write your own chart indicators in plain JavaScript, validate them here, and load them
            from the chart&apos;s Indicators dialog under <strong>Custom</strong>. Files live in{' '}
            <code>strategies/indicators/</code> on this PC.
          </p>
        </div>
      </header>

      <Alert>
        <AlertTitle>Indicators run with full app privileges</AlertTitle>
        <AlertDescription>
          A custom indicator is ordinary JavaScript on this app&apos;s origin — the same trust as
          code you run in the browser console. Only save code you have read and understood, whoever
          wrote it, including an LLM. Validation checks that it registers and draws; it does not
          make code safe.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section className="space-y-4" aria-label="Stored indicators">
          <div className="space-y-2 border p-4">
            <h2 className="font-semibold">On this PC</h2>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No custom indicators yet. Start from a template below.
              </p>
            ) : (
              <ul className="space-y-1">
                {files.map((entry) => (
                  <li key={entry.file}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-accent/50 ${
                        selected === entry.file ? 'bg-accent font-medium' : ''
                      }`}
                      onClick={() => void openFile(entry.file)}
                    >
                      <span className="font-mono">{entry.file}</span>
                      <span className="text-xs text-muted-foreground">
                        {Math.max(1, Math.round(entry.bytes / 1024))} kB
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border p-4">
            <h2 className="font-semibold">New indicator</h2>
            {TEMPLATES.map((template) => (
              <Button
                key={template.filename}
                variant="outline"
                className="w-full justify-start"
                onClick={() => openDraft(template.filename, template.source, null)}
              >
                {template.label}
              </Button>
            ))}
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => openDraft('my_indicator.js', '', null)}
            >
              Blank file
            </Button>
          </div>

          <div className="space-y-2 border p-4">
            <h2 className="font-semibold">Let an LLM write it</h2>
            <p className="text-sm text-muted-foreground">
              Download the skill file and hand it to your own LLM, or ask the built-in{' '}
              <Link to="/agent" className="underline">
                AI Agent
              </Link>{' '}
              — it knows this format and can save the file here for you (you approve the save).
              External tools can also use the MCP <code>save_custom_indicator</code> tool.
            </p>
            <Button variant="outline" className="w-full" onClick={() => void downloadSkill()}>
              Download SKILL.md for your LLM
            </Button>
          </div>
        </section>

        <section className="space-y-3 border p-4" aria-label="Indicator editor">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="indicator-filename">File name</Label>
              <Input
                id="indicator-filename"
                className="font-mono"
                value={filename}
                disabled={selected !== null}
                placeholder="my_indicator.js"
                onChange={(event) => setFilename(event.target.value)}
              />
            </div>
            {selected ? <Badge variant="secondary">editing saved file</Badge> : null}
            {dirty ? <Badge variant="outline">unsaved changes</Badge> : null}
          </div>

          <Textarea
            aria-label="Indicator source"
            className="min-h-[28rem] font-mono text-xs leading-relaxed"
            value={source}
            spellCheck={false}
            placeholder="export default function ({ registerIndicator }) { ... }"
            onChange={(event) => {
              setSource(event.target.value)
              setValidation(null)
              setValidatedSource(null)
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !source.trim()}
              onClick={() => void runValidation()}
            >
              Validate
            </Button>
            <Button
              disabled={busy || !validatedCurrent || (!selected && !filename.trim())}
              onClick={() => void save()}
            >
              {selected ? 'Save changes' : 'Save indicator'}
            </Button>
            {selected ? (
              confirmDelete ? (
                <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                  Confirm delete
                </Button>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )
            ) : null}
          </div>
          {!validatedCurrent && source.trim() ? (
            <p className="text-xs text-muted-foreground">
              Validate must pass on the current text before it can be saved.
            </p>
          ) : null}

          {validation ? (
            validation.ok ? (
              <Alert>
                <AlertTitle>Validation passed</AlertTitle>
                <AlertDescription>
                  {validation.indicators.map((item) => (
                    <span key={item.id} className="block">
                      {item.name} (<code>{item.id}</code>, {item.placement}) registered and drew on
                      sample bars.
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Validation failed</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {validation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )
          ) : null}

          {status ? <output className="block text-sm">{status}</output> : null}
        </section>
      </div>
    </div>
  )
}
