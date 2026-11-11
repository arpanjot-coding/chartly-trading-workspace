import { useEffect, useRef, useState } from 'react'
import {
  type DatasetPreview,
  dataLibrary,
  type PublicMarketInstrument,
  type PublicSourceObservation,
} from '@/api/dataLibrary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const field = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const PROVIDER_LABELS: Record<string, string> = {
  'mt5-terminal': 'MetaTrader 5 terminal history',
  'kraken-public': 'Kraken public spot history',
  'binance-public': 'Binance public spot history',
  'bybit-public': 'Bybit public spot history',
  'coinbase-public': 'Coinbase public spot history',
  'okx-public': 'OKX public spot history',
  'bitget-public': 'Bitget public spot history',
  'hyperliquid-public': 'Hyperliquid public perpetual history',
  'dukascopy-public': 'Dukascopy free FX history',
}
export function PublicSourceDetails({ observation }: { observation: PublicSourceObservation }) {
  return (
    <section aria-label="Public source coverage" className="space-y-2 border p-3 text-sm">
      <h3 className="font-semibold">
        {PROVIDER_LABELS[observation.provider] ?? 'Public market history'}
      </h3>
      <p>
        {observation.symbol} · {observation.interval} · {observation.closedRows} closed candles
      </p>
      <p>
        Returned candle opens (UTC): {new Date(observation.returnedFirst * 1000).toISOString()} →{' '}
        {new Date(observation.returnedLast * 1000).toISOString()}
      </p>
      <p>
        Fetched {observation.receivedAt}.
        {observation.excludedUnfinished > 0
          ? ' The final unfinished candle was excluded.'
          : ' Every returned candle was already closed.'}
      </p>
      <p>
        This source saves at most {observation.maxEntries} closed candles from the requested
        window. No missing candles or historical spreads are invented.
      </p>
      <p className="text-muted-foreground">{observation.scope}</p>
    </section>
  )
}

export default function DataLibraryPublicSource({
  principalId,
  revision,
  onPreview,
}: {
  principalId: string
  revision: number
  onPreview: (preview: DatasetPreview) => void
}) {
  const [search, setSearch] = useState('XBT')
  const [rows, setRows] = useState<PublicMarketInstrument[]>([])
  const [pair, setPair] = useState('')
  const [interval, setInterval] = useState('1m')
  const [intervals, setIntervals] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = useRef(principalId)
  owner.current = principalId
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    owner.current = principalId
    generation.current++
    setRows([])
    setIntervals([])
    setPair('')
    setError('')
    setBusy(false)
    return () => {
      generation.current++
      request.current?.abort()
    }
  }, [principalId])
  async function run(operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (busy) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const epoch = ++generation.current
    const current = () =>
      !controller.signal.aborted && owner.current === principalId && generation.current === epoch
    setBusy(true)
    setError('')
    try {
      await operation(controller.signal, current)
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error
            ? cause.message
            : 'The public source could not be read. Saved history is unchanged.'
        )
    } finally {
      if (current()) setBusy(false)
    }
  }
  return (
    <Card aria-label="Public market data source">
      <CardHeader>
        <CardTitle>Get public market history</CardTitle>
        <CardDescription>
          Kraken spot candles need no exchange account or API key. Fetch a bounded recent window,
          then review and save it with your other history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async (signal, current) => {
              const result = await dataLibrary.krakenInstruments(search, principalId, signal)
              if (!current()) return
              setRows(result.instruments)
              setIntervals(result.intervals)
              setPair('')
            })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="kraken-search">Search Kraken spot pairs</Label>
            <Input
              id="kraken-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={80}
              disabled={busy}
            />
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            Search public instruments
          </Button>
        </form>
        {!!intervals.length && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kraken-pair">Kraken spot instrument</Label>
                <select
                  id="kraken-pair"
                  className={field}
                  value={pair}
                  onChange={(event) => setPair(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose an online spot pair</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.symbol} · quoted in {row.quote}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="kraken-interval">Native candle interval</Label>
                <select
                  id="kraken-interval"
                  className={field}
                  value={interval}
                  onChange={(event) => setInterval(event.target.value)}
                  disabled={busy}
                >
                  {intervals.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
            {!rows.length && (
              <p className="text-sm">
                No supported online spot pairs match. Change the search and try again.
              </p>
            )}
            <Button
              disabled={busy || !pair || !intervals.includes(interval)}
              onClick={() =>
                void run(async (signal, current) => {
                  const preview = await dataLibrary.previewKraken(
                    { expectedRevision: revision, pair, interval },
                    principalId,
                    signal
                  )
                  if (current()) onPreview(preview)
                })
              }
            >
              {busy ? 'Reading public candles…' : 'Fetch closed candles and review'}
            </Button>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          At most 720 closed candles from the recent window; the unfinished final candle is
          excluded. You will see actual coverage and quality before publishing. This source does not
          connect an account, supply unlimited backfill or enable trading.
        </p>
      </CardContent>
    </Card>
  )
}
