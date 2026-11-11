import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { load, save, db, action, context, accept, report } = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  action: vi.fn(),
  context: vi.fn(),
  accept: vi.fn(),
  report: vi.fn(),
  db: {
    portfolios: { update: vi.fn() },
    journalTrades: { add: vi.fn(), update: vi.fn(), delete: vi.fn() },
    transaction: vi.fn(),
  },
}))
vi.mock('./db', () => ({ traderDb: db, nowIso: () => '2026-11-02T10:00:00Z' }))
vi.mock('./dataPersistence', () => ({
  loadTraderBinding: load,
  saveBackendTables: save,
  copyTables: structuredClone,
  newRecordId: (rows: { id: number }[]) => Math.max(0, ...rows.map((row) => row.id)) + 1,
  subscribeStorageChanges: () => () => {},
  acceptWorkspace: accept,
  reportJournalPersistence: report,
}))
vi.mock('./journalClient', () => ({ journalClient: { action } }))
vi.mock('./localStorageClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./localStorageClient')>()),
  localStorageClient: { context },
}))

import { emptyTraderTables } from './browserSnapshot'
import { useTraderData } from './useTraderData'
import { journalDrafts } from './journalDrafts'

beforeEach(() => vi.clearAllMocks())
describe('original journal persistence integration', () => {
  it.each([
    { principalId: 'alice', originId: 'previous-origin' },
    { principalId: 'other-account', originId: 'current-origin' },
  ])('refuses a prepared chart source from an obsolete workspace scope %j', async (scope) => {
    const tables = emptyTraderTables()
    tables.portfolios.push({ id: 7, name: 'Current profile' } as never)
    tables.practiceSessions.push({ id: 3, portfolioId: 7, status: 'Draft', symbol: 'EXAMPLE', timeframe: '1m' } as never)
    load.mockResolvedValue({
      kind: 'backend', tables, principalId: 'alice',
      workspace: { originId: 'current-origin', revision: 1, tables },
    })
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await expect(hook.result.current.updatePortfolio(7, { defaultSymbol: 'OLD' }, scope))
      .rejects.toThrow(/workspace changed/i)
    await expect(hook.result.current.updateSessionSource(3, {
      datasetVersionId: 'version-one', datasetChecksum: 'a'.repeat(64),
      symbol: 'EXAMPLE', timeframe: '1m', dataSource: 'Fixture',
    }, scope)).rejects.toThrow(/workspace changed/i)
    expect(save).not.toHaveBeenCalled()
    expect(db.portfolios.update).not.toHaveBeenCalled()
    expect(tables.portfolios[0].name).toBe('Current profile')
  })
  it('binds only an empty matching Draft to its first saved source without changing financial facts or status', async () => {
    const tables=emptyTraderTables()
    tables.practiceSessions.push({id:3,portfolioId:1,name:'Legacy draft',status:'Draft',symbol:'EXAMPLE',timeframe:'1m',dataSource:'none',startingBalance:10000,updatedAt:'2026-11-01'} as never)
    const binding={kind:'backend',tables,principalId:'alice',workspace:{originId:'source',revision:1,tables}}
    load.mockResolvedValue(binding)
    save.mockImplementation(async(_old,next)=>{const result={...binding,tables:next};load.mockResolvedValue(result);return result})
    const hook=renderHook(useTraderData);await waitFor(()=>expect(hook.result.current.loading).toBe(false))
    const source={datasetVersionId:'version-one',datasetChecksum:'a'.repeat(64),symbol:'EXAMPLE',timeframe:'1m',dataSource:'Fixture'}
    await act(async()=>{await hook.result.current.updateSessionSource(3,source)})
    expect(save.mock.calls[0][1].practiceSessions[0]).toMatchObject({...source,status:'Draft',startingBalance:10000})
    await expect(hook.result.current.updateSessionSource(3,{...source,datasetVersionId:'another'})).rejects.toThrow(/empty unbound Draft/)
  })
  it('keeps runs with archived or active journal trades from retrofitting their source provenance', async () => {
    const tables=emptyTraderTables()
    tables.practiceSessions.push({id:3,portfolioId:1,status:'Draft',symbol:'EXAMPLE',timeframe:'1m',updatedAt:'2026-11-01'} as never)
    tables.journalTrades.push({id:9,portfolioId:1,sessionId:3,archivedAt:'2026-11-02',openDate:'2026-11-01'} as never)
    load.mockResolvedValue({kind:'backend',tables,principalId:'alice',workspace:{originId:'source',revision:1,tables}})
    const hook=renderHook(useTraderData);await waitFor(()=>expect(hook.result.current.loading).toBe(false))
    await expect(hook.result.current.updateSessionSource(3,{datasetVersionId:'version-one',datasetChecksum:'a'.repeat(64),symbol:'EXAMPLE',timeframe:'1m',dataSource:'Fixture'})).rejects.toThrow(/empty unbound Draft/)
    expect(save).not.toHaveBeenCalled()
  })
  it('archives a profile through saved storage while retaining its journal and sessions', async () => {
    const tables = emptyTraderTables()
    tables.portfolios.push({
      id: 7,
      name: 'Original',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    } as never)
    tables.journalTrades.push({ id: 19, portfolioId: 7, openDate: '2026-01-01' } as never)
    tables.practiceSessions.push({ id: 23, portfolioId: 7, updatedAt: '2026-01-01' } as never)
    tables.profileDestinations.push({ id: 27, portfolioId: 7, copyingEnabled: true } as never)
    const binding = {
      kind: 'backend',
      tables,
      principalId: 'alice',
      workspace: { originId: 'source', revision: 3, tables },
    }
    load.mockResolvedValue(binding)
    save.mockImplementation(async (_old, next) => {
      const result = { ...binding, tables: next }
      load.mockResolvedValue(result)
      return result
    })
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => {
      await hook.result.current.deletePortfolio(7)
    })
    const saved = save.mock.calls[0][1]
    expect(saved.portfolios[0].archivedAt).toBe('2026-11-02T10:00:00Z')
    expect(saved.journalTrades).toEqual(tables.journalTrades)
    expect(saved.practiceSessions).toEqual(tables.practiceSessions)
    expect(saved.profileDestinations[0].copyingEnabled).toBe(false)
    expect(db.portfolios.update).not.toHaveBeenCalled()
    expect(hook.result.current.portfolios).toEqual([])
  })
  it('never writes into the original browser database when loading a saved account failed', async () => {
    load.mockRejectedValue(new Error('Saved account is unavailable'))
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await expect(hook.result.current.deleteTrade(19)).rejects.toThrow('Load the browser journal')
    expect(db.journalTrades.update).not.toHaveBeenCalled()
    expect(db.journalTrades.delete).not.toHaveBeenCalled()
  })
})

describe('P03 journal source and retry boundaries', () => {
  const row = {
    id: 19,
    portfolioId: 7,
    origin: 'manual',
    pair: 'EURUSD',
    direction: 'Buy',
    result: 'Open',
    openDate: '2026-01-01',
    closeDate: '',
    netPnl: 0,
    pnl: 0,
    lots: 0,
    duration: 0,
    technicalNotes: 'old',
    otherNotes: '',
    emotionalNotes: '',
    rr: 0,
    sl: 0,
    tp: 0,
    timeframe: '1h',
  }
  function browserBinding() {
    const tables = emptyTraderTables()
    tables.journalTrades.push(structuredClone(row) as never)
    const binding = { kind: 'browser', tables }
    load.mockResolvedValue(binding)
    db.journalTrades.update.mockImplementation(async (id, patch) => {
      Object.assign(tables.journalTrades.find((item) => item.id === id)!, patch)
      return 1
    })
    return binding
  }
  function savedBinding() {
    const tables = emptyTraderTables()
    tables.journalTrades.push({ ...row, openDate: '2026-01-01T00:00:00Z' } as never)
    const originId = crypto.randomUUID()
    const binding = {
      kind: 'backend',
      principalId: 'alice',
      tables,
      workspace: { originId, revision: 3, tables },
    }
    load.mockResolvedValue(binding)
    context.mockResolvedValue({ principalId: 'alice', activeOriginId: originId })
    return binding
  }
  it('adds review history without inventing timestamps or financial facts in a preserved browser journal', async () => {
    const binding = browserBinding()
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => {
      await hook.result.current.reviewTrade(19, {
        technicalNotes: 'reviewed',
        reviewStatus: 'reviewed',
      })
    })
    expect(binding.tables.journalTrades[0]).toMatchObject({
      openDate: '2026-01-01',
      closeDate: '',
      result: 'Open',
      netPnl: 0,
      reviewRevision: 1,
      reviewedAt: '2026-11-02T10:00:00Z',
      history: [
        {
          action: 'review',
          before: { technicalNotes: 'old' },
          after: { technicalNotes: 'reviewed' },
        },
      ],
    })
    expect(binding.tables.journalTrades[0].factRevision).toBeUndefined()
  })
  it('blocks imported financial edits while allowing a separate review and archive undo', async () => {
    const binding = browserBinding()
    binding.tables.journalTrades[0].origin = 'imported'
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await expect(hook.result.current.updateTrade(19, { netPnl: 999 })).rejects.toThrow(
      'Source execution facts are read-only'
    )
    await act(async () => {
      await hook.result.current.reviewTrade(19, { technicalNotes: 'source annotation' })
    })
    await act(async () => {
      await hook.result.current.deleteTrade(19)
    })
    expect(hook.result.current.trades).toEqual([])
    await act(async () => {
      await hook.result.current.restoreTrade(19)
    })
    expect(hook.result.current.trades[0]).toMatchObject({
      netPnl: 0,
      technicalNotes: 'source annotation',
    })
    expect(binding.tables.journalTrades[0].history?.map((item) => item.action)).toEqual([
      'review',
      'archive',
      'restore',
    ])
  })
  it('keeps synthetic browser book IDs out of saved manual rows for later P02 migration', async () => {
    browserBinding()
    db.journalTrades.add.mockResolvedValue(20)
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await act(async () => {
      await hook.result.current.createTrade({
        ...row,
        id: undefined,
        journalBookId: 'manual:7',
      } as never)
    })
    expect(db.journalTrades.add.mock.calls.at(-1)?.[0]).not.toHaveProperty('journalBookId')
  })
  it('retries an uncertain save with the exact original revision and request identity', async () => {
    const binding = savedBinding()
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    action.mockRejectedValueOnce(new Error('Connection lost after submission'))
    await act(async () => {
      await expect(
        hook.result.current.reviewTrade(
          19,
          { technicalNotes: 'unsent' },
          { bookId: 'b', requestId: 'same-id', expectedRevision: 3 }
        )
      ).rejects.toThrow('Connection lost')
    })
    const scope = { principalId: 'alice', originId: binding.workspace.originId, bookId: 'b' }
    expect(await journalDrafts.get(scope, 'request:same-id')).toBeDefined()
    const next = { ...binding, workspace: { ...binding.workspace, revision: 4 } }
    accept.mockResolvedValue(next)
    load.mockResolvedValue(next)
    action.mockResolvedValue({ workspace: next.workspace })
    await act(async () => {
      await hook.result.current.reviewTrade(
        19,
        { technicalNotes: 'unsent' },
        { bookId: 'b', requestId: 'same-id', expectedRevision: 99 }
      )
    })
    expect(action.mock.calls[0][0]).toEqual(action.mock.calls[1][0])
    expect(action.mock.calls[1][0].expectedRevision).toBe(3)
    expect(await journalDrafts.get(scope, 'request:same-id')).toBeUndefined()
  })
  it('never accepts a response into the cache after the signed-in owner or source changes', async () => {
    const binding = savedBinding()
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    context.mockResolvedValue({ principalId: 'bob', activeOriginId: binding.workspace.originId })
    action.mockResolvedValue({ workspace: { ...binding.workspace, revision: 4 } })
    await act(async () => {
      await expect(
        hook.result.current.reviewTrade(
          19,
          { technicalNotes: 'alice only' },
          { bookId: 'b', requestId: 'owner-change' }
        )
      ).rejects.toThrow('account or source changed')
    })
    expect(accept).not.toHaveBeenCalled()
    expect(
      await journalDrafts.get(
        { principalId: 'alice', originId: binding.workspace.originId, bookId: 'b' },
        'request:owner-change'
      )
    ).toBeDefined()
  })
  it('rejects contradictory manual amounts before a preserved-browser write and returns changed facts to unreviewed', async () => {
    const binding = browserBinding()
    Object.assign(binding.tables.journalTrades[0], {
      openDate: '2026-01-01T09:00:00Z',
      closeDate: '2026-01-01T10:00:00Z',
      result: 'Win',
      reviewStatus: 'reviewed',
      netPnl: 5,
      amounts: { netPnl: '5', grossPnl: '10', commission: '2', fees: '1', swap: '-2' },
    })
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    await expect(
      hook.result.current.updateTrade(
        19,
        { amounts: { netPnl: '99', grossPnl: '10', commission: '2', fees: '1', swap: '-2' } },
        { reason: 'wrong' }
      )
    ).rejects.toThrow('Net P&L must equal')
    expect(db.journalTrades.update).not.toHaveBeenCalled()
    await act(async () => {
      await hook.result.current.updateTrade(
        19,
        {
          netPnl: 6,
          amounts: { netPnl: '6', grossPnl: '11', commission: '2', fees: '1', swap: '-2' },
        },
        { reason: 'Corrected result' }
      )
    })
    expect(binding.tables.journalTrades[0]).toMatchObject({
      reviewStatus: 'unreviewed',
      factRevision: 1,
      history: [
        {
          reason: 'Corrected result',
          after: { netPnl: 6, reviewStatus: 'unreviewed', factRevision: 1 },
        },
      ],
    })
  })
  it('retains a failed archive under its canonical account book instead of a generic manual draft scope', async () => {
    const binding = savedBinding()
    Object.assign(binding.workspace, { bookAssignments: { '19': 'connected-book' } })
    const hook = renderHook(useTraderData)
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    action.mockRejectedValue(new Error('Engine unavailable'))
    await act(async () => {
      await expect(hook.result.current.deleteTrade(19)).rejects.toThrow('Engine unavailable')
    })
    const pending = await journalDrafts.list(
      { principalId: 'alice', originId: binding.workspace.originId, bookId: 'connected-book' },
      'request:'
    )
    expect(pending).toHaveLength(1)
    expect(pending[0].value).toMatchObject({ action: 'archive-trade', payload: { tradeId: 19 } })
    expect(
      await journalDrafts.list({
        principalId: 'alice',
        originId: binding.workspace.originId,
        bookId: 'manual',
      })
    ).toEqual([])
  })
})
