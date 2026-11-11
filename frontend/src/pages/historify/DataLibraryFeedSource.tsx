import { useEffect, useRef, useState } from 'react'
import { type DatasetPreview, dataLibrary } from '@/api/dataLibrary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_MARKET_IMPORT_PROVIDER,
  MARKET_IMPORT_PROVIDERS,
  marketHistoryParameters,
  marketImportLabel,
  marketProvider,
} from '@/lib/chart/marketProviders'

const field = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export default function DataLibraryFeedSource({
  principalId,
  revision,
  onPreview,
}: {
  principalId: string
  revision: number
  onPreview: (preview: DatasetPreview) => void
}) {
  const [provider, setProvider] = useState(DEFAULT_MARKET_IMPORT_PROVIDER.id)
  const [symbol, setSymbol] = useState(DEFAULT_MARKET_IMPORT_PROVIDER.exampleSymbol)
  const [interval, setInterval] = useState('1h')
  const [limit, setLimit] = useState('500')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const selected = marketProvider(provider) ?? DEFAULT_MARKET_IMPORT_PROVIDER
  const windowHours = selected.maxWindowHours

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const preview = await dataLibrary.previewFeed(
        {
          expectedRevision: revision,
          ...marketHistoryParameters(provider, symbol, interval, { limit, start, end }),
        },
        principalId,
        controller.signal
      )
      if (!controller.signal.aborted) onPreview(preview)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The feed could not be read. Saved history is unchanged.'
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <Card aria-label="Exchange and FX feed history">
      <CardHeader>
        <CardTitle>Get exchange &amp; FX history</CardTitle>
        <CardDescription>
          Preview closed candles from crypto exchanges or free Dukascopy FX history. Use the
          venue&apos;s symbol, such as {selected.exampleSymbol}. MT5 import requires verified UTC
          alignment. You can inspect MT5 broker time in the live chart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="feed-provider">Feed provider</Label>
            <select
              id="feed-provider"
              className={field}
              value={provider}
              onChange={(event) => {
                const next = MARKET_IMPORT_PROVIDERS.find((row) => row.id === event.target.value)
                if (!next) return
                setProvider(next.id)
                setSymbol(next.exampleSymbol)
                if (!next.intervals.includes(interval)) setInterval('1h')
                setError('')
              }}
              disabled={busy}
            >
              {MARKET_IMPORT_PROVIDERS.map((row) => (
                <option key={row.id} value={row.id}>
                  {marketImportLabel(row)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-symbol">Venue symbol</Label>
            <Input
              id="feed-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              maxLength={24}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-interval">Interval</Label>
            <select
              id="feed-interval"
              className={field}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              disabled={busy}
            >
              {selected.intervals.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          {!windowHours && (
            <div className="space-y-2">
              <Label htmlFor="feed-limit">Candles (max 1000)</Label>
              <Input
                id="feed-limit"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                inputMode="numeric"
                maxLength={4}
                disabled={busy}
              />
            </div>
          )}
          {windowHours && (
            <>
              <div className="space-y-2">
                <Label htmlFor="feed-start">Start (UTC)</Label>
                <Input
                  id="feed-start"
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="feed-end">End (UTC, under {windowHours}h)</Label>
                <Input
                  id="feed-end"
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          )}
          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? 'Fetching…' : 'Fetch & preview history'}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          Saved history from these feeds drives Replay and paper sessions. OANDA and other keyed
          feeds use your own API credentials on the market-data API; they are never stored.
        </p>
      </CardContent>
    </Card>
  )
}
