import { useCallback, useEffect, useRef, useState } from 'react'
import type { TraderTables } from './browserSnapshot'
import { browserOrigin } from './browserSnapshot'
import {
  acceptWorkspace,
  copyTables,
  type DataBinding,
  loadTraderBinding,
  newRecordId,
  reportJournalPersistence,
  saveBackendTables,
  subscribeStorageChanges,
} from './dataPersistence'
import {
  type BrokerAccount,
  type ChartViewCheckpoint,
  type DailyMood,
  type JournalTrade,
  nowIso,
  type PracticeSession,
  type ProfileDestination,
  type SessionStatus,
  type TraderPortfolio,
  type TradingProfileKind,
  type TradingTerminal,
  traderDb,
} from './db'
import { journalTimestamp as sourceTimestamp } from './journalAnalytics'
import { type JournalActionResponse, type JournalDetail, journalClient } from './journalClient'
import { type JournalDraftScope, journalDrafts } from './journalDrafts'
import { validateManualJournalAmounts } from './journalValidation'
import { LocalStorageError, localStorageClient } from './localStorageClient'
import { calculateRMultiple } from './metrics'
import {
  getDestinationOwnershipConflict,
  isBrokerAccountEnabled,
  validateDestinationSettings,
  withDefaultChartDataSource,
} from './profileModel'

export interface PortfolioInput {
  chartSource?: TraderPortfolio['chartSource']
  liveSetup?: TraderPortfolio['liveSetup']
  name: string
  kind: TradingProfileKind
  currency: string
  startingBalance: number
  sessionLabel?: string
  sessionTags?: string[]
  timezone?: string
  strategyTags?: string[]
  defaultSymbol?: string
  defaultTimeframe?: string
  emotionTrackingEnabled?: boolean
}

export type PracticeSessionInput = Omit<PracticeSession, 'id' | 'createdAt' | 'updatedAt'>
export type JournalTradeInput = Omit<JournalTrade, 'id' | 'rMultiple'>
export interface JournalMutationOptions {
  requestId?: string
  bookId?: string
  expectedRevision?: number
}
export interface ChartSourceScope {
  principalId: string
  originId: string
}
export type DailyMoodInput = Omit<DailyMood, 'id'>
export type BrokerAccountInput = Omit<BrokerAccount, 'id' | 'createdAt' | 'updatedAt'>
export type TradingTerminalInput = Omit<TradingTerminal, 'id' | 'createdAt' | 'updatedAt'>
export type ProfileDestinationInput = Omit<ProfileDestination, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: number
  createdAt?: string
}

export function useTraderData() {
  const binding = useRef<DataBinding | null>(null)
  const loadVersion = useRef(0)
  const [portfolios, setPortfolios] = useState<TraderPortfolio[]>([])
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [trades, setTrades] = useState<JournalTrade[]>([])
  const [moods, setMoods] = useState<DailyMood[]>([])
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccount[]>([])
  const [terminals, setTerminals] = useState<TradingTerminal[]>([])
  const [destinations, setDestinations] = useState<ProfileDestination[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storageMode, setStorageMode] = useState<'browser' | 'backend'>('browser')
  const [workspace, setWorkspace] = useState<DataBinding['workspace']>()
  const [readOnly, setReadOnly] = useState(false)
  const [journalSaving, setJournalSaving] = useState(false)

  const reload = useCallback(async () => {
    const version = ++loadVersion.current
    setLoading(true)
    setError(null)
    try {
      const loaded = await loadTraderBinding()
      if (version !== loadVersion.current) return
      binding.current = loaded
      setStorageMode(loaded.kind)
      setWorkspace(loaded.workspace)
      setReadOnly(!!loaded.readOnly)
      const rows = loaded.tables
      const visible = <T extends { archivedAt?: string }>(values: T[]) =>
        values.filter((row) => !row.archivedAt)
      setPortfolios(visible(rows.portfolios).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      setSessions(
        visible(rows.practiceSessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      )
      setTrades(visible(rows.journalTrades).sort((a, b) => b.openDate.localeCompare(a.openDate)))
      setMoods(visible(rows.dailyMoods).sort((a, b) => b.date.localeCompare(a.date)))
      setBrokerAccounts(
        visible(rows.brokerAccounts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      )
      setTerminals(visible(rows.terminals).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setDestinations(visible(rows.profileDestinations))
    } catch (err) {
      if (version !== loadVersion.current) return
      if (err instanceof LocalStorageError && err.status === 401) {
        binding.current = null
        setWorkspace(undefined)
        setPortfolios([])
        setSessions([])
        setTrades([])
        setMoods([])
        setBrokerAccounts([])
        setTerminals([])
        setDestinations([])
      }
      setError(err instanceof Error ? err.message : 'Local trader data could not be loaded.')
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const unsubscribe = subscribeStorageChanges(() => void reload())
    return () => {
      loadVersion.current++
      unsubscribe()
    }
  }, [reload])

  const persistBackend = useCallback(
    async <T>(
      mutate: (tables: TraderTables) => T,
      expectedScope?: ChartSourceScope
    ): Promise<{ handled: true; value: T } | { handled: false }> => {
      const current = binding.current
      if (!current)
        throw new LocalStorageError(
          'storage.not_loaded',
          'Load the current workspace before editing records.'
        )
      if (
        expectedScope &&
        (current.kind !== 'backend' ||
          current.principalId !== expectedScope.principalId ||
          current.workspace?.originId !== expectedScope.originId)
      )
        throw new LocalStorageError(
          'storage.scope_changed',
          'The workspace changed. Reopen the source picker in the current profile.',
          409
        )
      if (current.kind !== 'backend') return { handled: false }
      const tables = copyTables(current.tables)
      const value = mutate(tables)
      binding.current = await saveBackendTables(current, tables)
      await reload()
      return { handled: true, value }
    },
    [reload]
  )

  const journalScope = useCallback((bookId?: string): JournalDraftScope => {
    const current = binding.current
    if (!current) throw new Error('Load the journal before editing.')
    return {
      principalId: current.principalId ?? 'preserved-browser-source',
      originId: current.workspace?.originId ?? browserOrigin(),
      bookId: bookId ?? 'manual',
    }
  }, [])

  const acceptJournalResponse = useCallback(
    async (response: JournalActionResponse) => {
      const current = binding.current
      if (!current || current.kind !== 'backend' || !current.workspace)
        throw new Error('Load the saved journal before accepting an update.')
      const context = await localStorageClient.context()
      if (
        context.principalId !== current.principalId ||
        context.activeOriginId !== current.workspace.originId ||
        response.workspace.originId !== current.workspace.originId
      )
        throw new Error(
          'The account or source changed during save. Reopen the intended journal; its submitted draft is retained.'
        )
      binding.current = await acceptWorkspace(response.workspace, context)
      await reload()
      return response
    },
    [reload]
  )

  const performJournalAction = useCallback(
    async (action: string, payload: Record<string, unknown>, options?: JournalMutationOptions) => {
      const current = binding.current
      if (!current?.workspace || current.kind !== 'backend')
        throw new Error('Set up durable local storage before using this journal action.')
      if (current.readOnly)
        throw new Error('Reconnect the local engine before editing. The saved copy is read-only.')
      const scope = journalScope(options?.bookId)
      const pending = options?.requestId
        ? undefined
        : (await journalDrafts.list(scope, 'request:')).find((draft) => {
            const body = draft.value as { action?: string; payload?: unknown }
            return (
              draft.kind.startsWith('request:') &&
              body.action === action &&
              JSON.stringify(body.payload) === JSON.stringify(payload)
            )
          })
      const requestId =
        options?.requestId ??
        (pending?.value as { requestId?: string } | undefined)?.requestId ??
        crypto.randomUUID()
      const draftKind = `request:${requestId}`
      const previous = await journalDrafts.get<{
        originId: string
        expectedRevision: number
        requestId: string
        action: string
        payload: Record<string, unknown>
      }>(scope, draftKind)
      const request = previous?.value ?? {
        originId: current.workspace.originId,
        expectedRevision: options?.expectedRevision ?? current.workspace.revision,
        requestId,
        action,
        payload,
      }
      if (request.action !== action || JSON.stringify(request.payload) !== JSON.stringify(payload))
        throw new Error(
          'An uncertain save with this request ID is retained. Retry its submitted values or reload and compare before starting a new edit.'
        )
      await journalDrafts.save(scope, draftKind, request)
      setJournalSaving(true)
      setError(null)
      reportJournalPersistence('saving', 'Saving the journal to the local engine…')
      try {
        const response = await journalClient.action(request)
        await acceptJournalResponse(response)
        await journalDrafts.delete(scope, draftKind)
        return response
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'Journal save failed. Your draft is retained.'
        setError(message)
        reportJournalPersistence(
          cause instanceof LocalStorageError && cause.status === 409 ? 'conflict' : 'error',
          message
        )
        throw cause
      } finally {
        setJournalSaving(false)
      }
    },
    [acceptJournalResponse, journalScope]
  )

  const changeBrowserTrade = useCallback(
    async (id: number, patch: Partial<JournalTrade>, action: string, reason?: string) => {
      const current = binding.current
      if (!current || current.kind !== 'browser')
        throw new Error('Load the browser journal before editing.')
      const existing = current.tables.journalTrades.find((row) => row.id === id)
      if (!existing || (existing.archivedAt && action !== 'restore'))
        throw new Error('The journal entry is unavailable. Reload the book.')
      if (
        !['review', 'archive', 'restore'].includes(action) &&
        existing.origin &&
        existing.origin !== 'manual'
      )
        throw new Error('Source execution facts are read-only. Edit this entry’s review instead.')
      const at = nowIso()
      const next = { ...existing, ...patch }
      if (next.journalBookId?.startsWith('manual:')) delete next.journalBookId
      for (const field of Object.keys(patch) as (keyof JournalTrade)[])
        if (patch[field] === null) delete next[field]
      if (['edit', 'close'].includes(action)) {
        validateManualJournalAmounts(next.amounts)
        if (sourceTimestamp(next.openDate) === null)
          throw new Error(
            'Choose the intended timezone and enter a valid open timestamp before changing execution facts.'
          )
        if (
          next.result !== 'Open' &&
          (!next.closeDate ||
            sourceTimestamp(next.closeDate) === null ||
            Date.parse(next.closeDate) < Date.parse(next.openDate))
        )
          throw new Error('A closed trade needs a valid close timestamp at or after its open time.')
        if (next.result === 'Open') next.closeDate = ''
        next.duration = next.closeDate
          ? Math.max(
              0,
              Math.round((Date.parse(next.closeDate) - Date.parse(next.openDate)) / 60_000)
            )
          : 0
        next.rMultiple = calculateRMultiple(next.netPnl, next.riskAmount)
        const financialFields = [
          'pair',
          'direction',
          'openDate',
          'closeDate',
          'timeframe',
          'currency',
          'quantityUnit',
          'amounts',
          'netPnl',
          'grossPnl',
          'commission',
          'swap',
          'fees',
          'lots',
          'riskAmount',
          'entryPrice',
          'exitPrice',
          'result',
          'sourceTimezone',
        ] as const
        const changedFacts = financialFields.some(
          (field) => JSON.stringify(existing[field]) !== JSON.stringify(next[field])
        )
        if (changedFacts) {
          next.factRevision = (existing.factRevision ?? 0) + 1
          if (existing.reviewStatus === 'reviewed') next.reviewStatus = 'unreviewed'
        }
        const reviewFields = [
          'strategy',
          'setup',
          'tags',
          'rating',
          'chartUrl',
          'preTradeState',
          'conviction',
          'planConfirmed',
          'riskDefined',
          'emotion',
          'emotionalNotes',
          'technicalNotes',
          'otherNotes',
          'reviewStatus',
          'decisionId',
          'copyGroupId',
        ] as const
        if (
          reviewFields.some(
            (field) => JSON.stringify(existing[field]) !== JSON.stringify(next[field])
          )
        )
          next.reviewRevision = (existing.reviewRevision ?? 0) + 1
      }
      if (action === 'review') next.reviewRevision = (existing.reviewRevision ?? 0) + 1
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const field of new Set([...Object.keys(existing), ...Object.keys(next)]) as Set<
        keyof JournalTrade
      >)
        if (
          field !== 'history' &&
          JSON.stringify(existing[field]) !== JSON.stringify(next[field])
        ) {
          before[field] = existing[field]
          after[field] = next[field]
        }
      const historical = existing as JournalTrade & { history?: Record<string, unknown>[] }
      if ((historical.history?.length ?? 0) >= 1000)
        throw new Error(
          'This browser entry has reached 1,000 history changes. Export the book and migrate to durable storage before another change; history is retained.'
        )
      const history = [
        ...(historical.history ?? []),
        { id: crypto.randomUUID(), at, action, reason, before, after },
      ]
      await traderDb.journalTrades.update(id, { ...next, history } as Partial<JournalTrade>)
      await reload()
    },
    [reload]
  )

  const updateTrade = useCallback(
    async (
      id: number,
      patch: Partial<JournalTrade>,
      options?: JournalMutationOptions & { reason?: string; close?: boolean }
    ) => {
      if (binding.current?.kind === 'backend')
        return performJournalAction(
          options?.close ? 'close-trade' : 'update-trade',
          { tradeId: id, patch, ...(options?.reason ? { reason: options.reason } : {}) },
          options
        )
      await changeBrowserTrade(id, patch, options?.close ? 'close' : 'edit', options?.reason)
    },
    [changeBrowserTrade, performJournalAction]
  )

  const reviewTrade = useCallback(
    async (id: number, review: Record<string, unknown>, options?: JournalMutationOptions) => {
      if (binding.current?.kind === 'backend')
        return performJournalAction('review-trade', { tradeId: id, review }, options)
      await changeBrowserTrade(
        id,
        {
          ...review,
          reviewedAt: review.reviewStatus === 'reviewed' ? nowIso() : undefined,
        } as Partial<JournalTrade>,
        'review'
      )
    },
    [changeBrowserTrade, performJournalAction]
  )

  const tradeDetail = useCallback(async (id: number): Promise<JournalDetail> => {
    const current = binding.current
    if (!current) throw new Error('Load the journal before opening trade detail.')
    if (current.kind === 'backend' && current.workspace)
      return journalClient.detail(current.workspace.originId, id)
    const trade = current.tables.journalTrades.find((row) => row.id === id)
    if (!trade) throw new Error('Journal entry is unavailable.')
    return {
      trade,
      history: (trade as JournalTrade & { history?: Record<string, unknown>[] }).history ?? [],
      executions: [],
    }
  }, [])

  const createPortfolio = useCallback(
    async (input: PortfolioInput) => {
      const at = nowIso()
      const saved = await persistBackend((tables) => {
        const id = newRecordId(tables.portfolios)
        tables.portfolios.push({ ...input, id, createdAt: at, updatedAt: at })
        return id
      })
      if (saved.handled) return saved.value
      const id = await traderDb.portfolios.add({ ...input, createdAt: at, updatedAt: at })
      await reload()
      return id
    },
    [reload, persistBackend]
  )

  const updatePortfolio = useCallback(
    async (
      id: number,
      patch: Partial<Omit<TraderPortfolio, 'id' | 'createdAt'>>,
      expectedScope?: ChartSourceScope
    ) => {
      const saved = await persistBackend((tables) => {
        const row = tables.portfolios.find((item) => item.id === id)
        if (!row) throw new Error('Profile no longer exists. Reload records.')
        Object.assign(row, patch, { updatedAt: nowIso() })
      }, expectedScope)
      if (saved.handled) return
      await traderDb.portfolios.update(id, { ...patch, updatedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const deletePortfolio = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.portfolios.find((item) => item.id === id)
        if (row) Object.assign(row, { archivedAt: nowIso(), updatedAt: nowIso() })
        for (const destination of tables.profileDestinations.filter(
          (item) => item.portfolioId === id
        ))
          destination.copyingEnabled = false
      })
      if (saved.handled) return
      await traderDb.transaction(
        'rw',
        traderDb.portfolios,
        traderDb.profileDestinations,
        async () => {
          await traderDb.portfolios.update(id, { archivedAt: nowIso(), updatedAt: nowIso() })
          await traderDb.profileDestinations
            .where('portfolioId')
            .equals(id)
            .modify((row) => {
              row.copyingEnabled = false
            })
        }
      )
      await reload()
    },
    [reload, persistBackend]
  )

  const createSession = useCallback(
    async (input: PracticeSessionInput) => {
      const at = nowIso()
      const saved = await persistBackend((tables) => {
        const id = newRecordId(tables.practiceSessions)
        tables.practiceSessions.push({ ...input, id, createdAt: at, updatedAt: at })
        return id
      })
      if (saved.handled) return saved.value
      const id = await traderDb.practiceSessions.add({ ...input, createdAt: at, updatedAt: at })
      await reload()
      return id
    },
    [reload, persistBackend]
  )

  const updateSessionStatus = useCallback(
    async (id: number, status: SessionStatus) => {
      const saved = await persistBackend((tables) => {
        const row = tables.practiceSessions.find((item) => item.id === id)
        if (row) Object.assign(row, { status, updatedAt: nowIso() })
      })
      if (saved.handled) return
      await traderDb.practiceSessions.update(id, { status, updatedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const deleteSession = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.practiceSessions.find((item) => item.id === id)
        if (row) row.archivedAt = nowIso()
      })
      if (saved.handled) return
      await traderDb.practiceSessions.update(id, { archivedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const updateSessionChartView = useCallback(
    async (id: number, chartView: ChartViewCheckpoint) => {
      const saved = await persistBackend((tables) => {
        const row = tables.practiceSessions.find((item) => item.id === id && !item.archivedAt)
        if (!row) throw new Error('This run is no longer available. Reopen it from Workspace.')
        Object.assign(row, { chartView, updatedAt: nowIso() })
      })
      if (saved.handled) return
      await traderDb.practiceSessions.update(id, { chartView, updatedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const updateSessionSource = useCallback(
    async (
      id: number,
      source: {
        datasetVersionId: string
        datasetChecksum: string
        symbol: string
        timeframe: string
        dataSource: string
        rangeStart?: string
        rangeEnd?: string
      },
      expectedScope?: ChartSourceScope
    ) => {
      const saved = await persistBackend((tables) => {
        const row = tables.practiceSessions.find((item) => item.id === id && !item.archivedAt)
        if (
          !row ||
          row.status !== 'Draft' ||
          row.datasetVersionId ||
          row.symbol !== source.symbol ||
          row.timeframe !== source.timeframe ||
          tables.journalTrades.some((trade) => trade.sessionId === id)
        )
          throw new Error(
            'Only an empty unbound Draft can choose matching native history. Prepare another Draft for a different dataset.'
          )
        Object.assign(row, source, { updatedAt: nowIso() })
      }, expectedScope)
      if (saved.handled) return
      await traderDb.transaction(
        'rw',
        traderDb.practiceSessions,
        traderDb.journalTrades,
        async () => {
          const row = await traderDb.practiceSessions.get(id)
          if (
            !row ||
            row.status !== 'Draft' ||
            row.datasetVersionId ||
            row.symbol !== source.symbol ||
            row.timeframe !== source.timeframe ||
            (await traderDb.journalTrades.where('sessionId').equals(id).count())
          )
            throw new Error(
              'Only an empty unbound Draft can choose matching native history. Prepare another Draft.'
            )
          await traderDb.practiceSessions.update(id, { ...source, updatedAt: nowIso() })
        }
      )
      await reload()
    },
    [reload, persistBackend]
  )

  const createTrade = useCallback(
    async (input: JournalTradeInput, options?: JournalMutationOptions) => {
      if (!input.origin || input.origin === 'manual') validateManualJournalAmounts(input.amounts)
      if (binding.current?.kind === 'backend' && (!input.origin || input.origin === 'manual')) {
        const response = await performJournalAction('create-trade', { trade: input }, options)
        return response.detail?.trade.id ?? Number(response.result?.tradeId)
      }
      const saved = await persistBackend((tables) => {
        const id = newRecordId(tables.journalTrades)
        tables.journalTrades.push({
          ...input,
          id,
          rMultiple: calculateRMultiple(input.netPnl, input.riskAmount),
        })
        return id
      })
      if (saved.handled) return saved.value
      const browserTrade = {
        ...input,
        rMultiple: calculateRMultiple(input.netPnl, input.riskAmount),
      }
      for (const field of ['rating', 'chartUrl', 'conviction', 'emotion'] as const)
        if (browserTrade[field] === null) delete browserTrade[field]
      if (!browserTrade.journalBookId || browserTrade.journalBookId.startsWith('manual:'))
        delete browserTrade.journalBookId
      const id = await traderDb.journalTrades.add(browserTrade)
      await reload()
      return id
    },
    [reload, persistBackend, performJournalAction]
  )

  const deleteTrade = useCallback(
    async (id: number) => {
      if (binding.current?.kind === 'backend') {
        const bookId =
          binding.current.workspace?.bookAssignments?.[`journalTrades:${id}`] ??
          binding.current.workspace?.bookAssignments?.[String(id)] ??
          binding.current.tables.journalTrades.find((trade) => trade.id === id)?.journalBookId
        await performJournalAction('archive-trade', { tradeId: id }, { bookId })
        return
      }
      await changeBrowserTrade(id, { archivedAt: nowIso() }, 'archive')
    },
    [performJournalAction, changeBrowserTrade]
  )

  const restoreTrade = useCallback(
    async (id: number) => {
      if (binding.current?.kind === 'backend') {
        const bookId =
          binding.current.workspace?.bookAssignments?.[`journalTrades:${id}`] ??
          binding.current.workspace?.bookAssignments?.[String(id)] ??
          binding.current.tables.journalTrades.find((trade) => trade.id === id)?.journalBookId
        await performJournalAction('restore-trade', { tradeId: id }, { bookId })
        return
      }
      await changeBrowserTrade(id, { archivedAt: undefined }, 'restore')
    },
    [performJournalAction, changeBrowserTrade]
  )

  const saveMood = useCallback(
    async (input: DailyMoodInput) => {
      const saved = await persistBackend((tables) => {
        const existing = tables.dailyMoods.find(
          (item) => item.portfolioId === input.portfolioId && item.date === input.date
        )
        if (existing) Object.assign(existing, input, { archivedAt: undefined })
        else tables.dailyMoods.push({ ...input, id: newRecordId(tables.dailyMoods) })
      })
      if (saved.handled) return
      const existing = await traderDb.dailyMoods
        .where('[portfolioId+date]')
        .equals([input.portfolioId, input.date])
        .first()
      if (existing?.id) {
        await traderDb.dailyMoods.update(existing.id, input)
      } else {
        await traderDb.dailyMoods.add(input)
      }
      await reload()
    },
    [reload, persistBackend]
  )

  const deleteMood = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.dailyMoods.find((item) => item.id === id)
        if (row) row.archivedAt = nowIso()
      })
      if (saved.handled) return
      await traderDb.dailyMoods.update(id, { archivedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const createBrokerAccount = useCallback(
    async (input: BrokerAccountInput) => {
      const at = nowIso()
      const saved = await persistBackend((tables) => {
        const id = newRecordId(tables.brokerAccounts)
        tables.brokerAccounts.push({
          ...input,
          id,
          enabled: input.enabled ?? true,
          createdAt: at,
          updatedAt: at,
        })
        return id
      })
      if (saved.handled) return saved.value
      const id = await traderDb.brokerAccounts.add({
        ...input,
        enabled: input.enabled ?? true,
        createdAt: at,
        updatedAt: at,
      })
      await reload()
      return id
    },
    [reload, persistBackend]
  )

  const updateBrokerAccount = useCallback(
    async (id: number, patch: Partial<Omit<BrokerAccount, 'id' | 'createdAt'>>) => {
      const saved = await persistBackend((tables) => {
        const row = tables.brokerAccounts.find((item) => item.id === id)
        if (row) Object.assign(row, patch, { updatedAt: nowIso() })
        if (patch.enabled === false)
          for (const destination of tables.profileDestinations.filter(
            (item) => item.accountId === id
          ))
            destination.copyingEnabled = false
      })
      if (saved.handled) return
      await traderDb.transaction(
        'rw',
        traderDb.brokerAccounts,
        traderDb.profileDestinations,
        async () => {
          await traderDb.brokerAccounts.update(id, { ...patch, updatedAt: nowIso() })
          if (patch.enabled === false) {
            await traderDb.profileDestinations
              .where('accountId')
              .equals(id)
              .modify((destination) => {
                destination.copyingEnabled = false
                destination.updatedAt = nowIso()
              })
          }
        }
      )
      await reload()
    },
    [reload, persistBackend]
  )

  const deleteBrokerAccount = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.brokerAccounts.find((item) => item.id === id)
        if (row) Object.assign(row, { archivedAt: nowIso(), enabled: false })
        for (const destination of tables.profileDestinations.filter(
          (item) => item.accountId === id
        ))
          destination.copyingEnabled = false
      })
      if (saved.handled) return
      await traderDb.transaction(
        'rw',
        traderDb.brokerAccounts,
        traderDb.profileDestinations,
        async () => {
          await traderDb.brokerAccounts.update(id, { archivedAt: nowIso(), enabled: false })
          await traderDb.profileDestinations
            .where('accountId')
            .equals(id)
            .modify((row) => {
              row.copyingEnabled = false
            })
        }
      )
      await reload()
    },
    [reload, persistBackend]
  )

  const createTerminal = useCallback(
    async (input: TradingTerminalInput) => {
      const at = nowIso()
      const saved = await persistBackend((tables) => {
        const id = newRecordId(tables.terminals)
        tables.terminals.push({ ...input, id, createdAt: at, updatedAt: at })
        return id
      })
      if (saved.handled) return saved.value
      const id = await traderDb.terminals.add({ ...input, createdAt: at, updatedAt: at })
      await reload()
      return id
    },
    [reload, persistBackend]
  )

  const updateTerminal = useCallback(
    async (id: number, patch: Partial<Omit<TradingTerminal, 'id' | 'createdAt'>>) => {
      const saved = await persistBackend((tables) => {
        const row = tables.terminals.find((item) => item.id === id)
        if (row) Object.assign(row, patch, { updatedAt: nowIso() })
      })
      if (saved.handled) return
      await traderDb.terminals.update(id, { ...patch, updatedAt: nowIso() })
      await reload()
    },
    [reload, persistBackend]
  )

  const deleteTerminal = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.terminals.find((item) => item.id === id)
        if (row) Object.assign(row, { archivedAt: nowIso(), running: false })
        for (const destination of tables.profileDestinations.filter(
          (item) => item.terminalId === id
        ))
          destination.copyingEnabled = false
      })
      if (saved.handled) return
      await traderDb.terminals.update(id, { archivedAt: nowIso(), running: false })
      await reload()
    },
    [reload, persistBackend]
  )

  const saveDestination = useCallback(
    async (input: ProfileDestinationInput) => {
      const at = nowIso()
      let candidate: ProfileDestination = {
        ...input,
        createdAt: input.createdAt ?? at,
        updatedAt: at,
      }
      const errors = validateDestinationSettings(candidate)
      if (errors.length) throw new Error(errors[0])
      const saved = await persistBackend((tables) => {
        const account = tables.brokerAccounts.find((item) => item.id === candidate.accountId)
        if (candidate.copyingEnabled && !isBrokerAccountEnabled(account))
          throw new Error('Turn this broker account on before enabling copying to it.')
        if (!candidate.id)
          candidate = withDefaultChartDataSource(tables.profileDestinations, candidate)
        if (getDestinationOwnershipConflict(tables.profileDestinations, candidate))
          throw new Error(
            'This broker account is already armed by another live profile. Pause that destination first.'
          )
        if (candidate.isChartDataSource)
          for (const row of tables.profileDestinations.filter(
            (item) => item.portfolioId === candidate.portfolioId && item.id !== candidate.id
          ))
            row.isChartDataSource = false
        const id = candidate.id ?? newRecordId(tables.profileDestinations)
        const index = tables.profileDestinations.findIndex((item) => item.id === id)
        if (index < 0) tables.profileDestinations.push({ ...candidate, id })
        else tables.profileDestinations[index] = { ...candidate, id }
        return id
      })
      if (saved.handled) return saved.value

      let savedId = input.id ?? 0
      await traderDb.transaction(
        'rw',
        traderDb.brokerAccounts,
        traderDb.profileDestinations,
        async () => {
          const account = await traderDb.brokerAccounts.get(candidate.accountId)
          if (candidate.copyingEnabled && !isBrokerAccountEnabled(account)) {
            throw new Error('Turn this broker account on before enabling copying to it.')
          }
          const all = await traderDb.profileDestinations.toArray()
          if (!candidate.id) candidate = withDefaultChartDataSource(all, candidate)
          const conflict = getDestinationOwnershipConflict(all, candidate)
          if (conflict) {
            throw new Error(
              'This broker account is already armed by another live profile. Pause that destination first.'
            )
          }

          if (candidate.isChartDataSource) {
            await traderDb.profileDestinations
              .where('portfolioId')
              .equals(candidate.portfolioId)
              .modify((destination) => {
                if (destination.id !== candidate.id) destination.isChartDataSource = false
              })
          }

          if (candidate.id) {
            await traderDb.profileDestinations.put(candidate)
            savedId = candidate.id
          } else {
            savedId = await traderDb.profileDestinations.add(candidate)
          }
        }
      )
      await reload()
      return savedId
    },
    [reload, persistBackend]
  )

  const deleteDestination = useCallback(
    async (id: number) => {
      const saved = await persistBackend((tables) => {
        const row = tables.profileDestinations.find((item) => item.id === id)
        if (row) Object.assign(row, { archivedAt: nowIso(), copyingEnabled: false })
      })
      if (saved.handled) return
      await traderDb.profileDestinations.update(id, { archivedAt: nowIso(), copyingEnabled: false })
      await reload()
    },
    [reload, persistBackend]
  )

  return {
    portfolios,
    sessions,
    trades,
    moods,
    brokerAccounts,
    terminals,
    destinations,
    loading,
    error,
    storageMode,
    readOnly,
    journalSaving,
    workspace,
    principalId: binding.current?.principalId,
    journalScope,
    performJournalAction,
    acceptJournalResponse,
    updateTrade,
    reviewTrade,
    tradeDetail,
    books: workspace?.books ?? [],
    bookAssignments: workspace?.bookAssignments ?? {},
    reload,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    createSession,
    updateSessionStatus,
    updateSessionChartView,
    updateSessionSource,
    deleteSession,
    createTrade,
    deleteTrade,
    restoreTrade,
    saveMood,
    deleteMood,
    createBrokerAccount,
    updateBrokerAccount,
    deleteBrokerAccount,
    createTerminal,
    updateTerminal,
    deleteTerminal,
    saveDestination,
    deleteDestination,
  }
}
