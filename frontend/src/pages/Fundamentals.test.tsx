import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { researchClient } from '@/lib/trader/researchClient'
import { useAuthStore } from '@/stores/authStore'
import Fundamentals from './Fundamentals'

vi.mock('@/lib/trader/researchClient', () => ({
  researchClient: {
    issuers: vi.fn(),
    issuer: vi.fn(),
    statement: vi.fn(),
    metrics: vi.fn(),
    coverage: vi.fn(),
    events: vi.fn(),
    documents: vi.fn(),
    notes: vi.fn(),
    addNote: vi.fn(),
    snapshots: vi.fn(),
    saveSnapshot: vi.fn(),
    compare: vi.fn(),
    overlay: vi.fn(),
    ingest: vi.fn(),
    runNextIngestion: vi.fn(),
  },
}))
vi.mock('@/components/research/ResearchOverlayChart', () => ({
  default: ({ lineLabel }: { lineLabel: string }) => <p>overlay chart: {lineLabel}</p>,
}))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    storageMode: 'backend',
    workspace: { originId: 'research-fixture' },
    reload: vi.fn(),
  }),
}))

const issuer = {
  id: 'issuer-msft-001',
  name: 'MICROSOFT CORP',
  country: 'US',
  identifiers: [
    { namespace: 'cik', key: '789019' },
    { namespace: 'ticker', key: 'MSFT' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ isLocalAuthenticated: true, localPrincipalId: 'research-owner', user: null })
  vi.mocked(researchClient.issuers).mockResolvedValue({ issuers: [issuer] })
  vi.mocked(researchClient.issuer).mockResolvedValue({
    issuer,
    documentCount: 3,
    factCount: 3,
  })
  vi.mocked(researchClient.statement).mockResolvedValue({
    statement: 'income',
    view: 'latest-restated',
    scale: 'millions',
    lines: [
      {
        line: 'revenue',
        concept: 'us-gaap:Revenues',
        value: '246000000000',
        displayValue: '246000',
        unit: 'USD',
        periodEnd: '2025-06-30',
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        citation: '10-K/A accession 0000950170-26-000020',
      },
    ],
    unavailable: [{ line: 'gross_profit', reason: 'no_reported_fact' }],
    segmentData: { status: 'unavailable', reason: 'consolidated only' },
  })
  vi.mocked(researchClient.metrics).mockResolvedValue({
    metrics: [
      {
        id: 'derivedmetric-net-margin',
        formulaId: 'net-margin',
        unavailableReason: 'missing_input',
        unit: 'pure',
        inputFactIds: [],
      },
    ],
  })
  vi.mocked(researchClient.coverage).mockResolvedValue({
    fields: [
      { line: 'revenue', status: 'available', definition: 'Revenue.', concept: 'us-gaap:Revenues' },
      { line: 'total_assets', status: 'available', definition: 'Assets.', concept: 'us-gaap:Assets' },
    ],
    gatedCapabilities: [{ capability: 'estimates', status: 'unavailable', reason: 'gated' }],
  })
  vi.mocked(researchClient.documents).mockResolvedValue({
    documents: [
      {
        id: 'documentversion-msft0',
        nativeDocumentId: '0000950170-26-000020',
        sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/x.htm',
      },
    ],
  })
  vi.mocked(researchClient.overlay).mockResolvedValue({
    series: { line: 'revenue', concept: 'us-gaap:Revenues', points: [] },
    events: [],
    semantics: { seriesDates: 'period end', eventDates: 'publication', interpolated: false, sources: [] },
  })
  vi.mocked(researchClient.notes).mockResolvedValue({ notes: [] })
  vi.mocked(researchClient.snapshots).mockResolvedValue({ snapshots: [] })
  vi.mocked(researchClient.events).mockResolvedValue({
    events: [
      {
        time: '2026-02-01T17:00:00.000Z',
        accession: '0000950170-26-000020',
        sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000095017026000020/msft-10ka.htm',
      },
    ],
  })
})
afterEach(() => cleanup())

describe('Fundamentals thin journey', () => {
  it('opens a company with sourced statement lines and honest gaps', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Fundamentals />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: /MICROSOFT CORP/ }))
    await waitFor(() => expect(screen.getByText('246000')).toBeVisible())
    expect(screen.getByText(/10-K\/A accession/)).toBeVisible()
    expect(screen.getByText(/Not reported \/ unavailable: gross_profit/)).toBeVisible()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element?.textContent === 'net-margin: unavailable (missing_input)'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '0000950170-26-000020' })).toHaveAttribute(
      'href',
      expect.stringContaining('sec.gov/Archives')
    )
    expect(screen.getByText(/Not yet sourced: estimates/)).toBeVisible()
    expect(screen.getByText('overlay chart: revenue')).toBeVisible()
    expect(vi.mocked(researchClient.overlay).mock.calls[0][2]).toBe('revenue')
  })

  it('saves a cited snapshot and a filing note, and filters companies', async () => {
    vi.mocked(researchClient.saveSnapshot).mockResolvedValue({} as never)
    vi.mocked(researchClient.snapshots).mockResolvedValue({
      snapshots: [
        { id: 'researchsnapshot-1', label: 'Why I believe this', savedAt: '2026-11-04T12:00:00Z', factCount: 3 },
      ],
    })
    vi.mocked(researchClient.addNote).mockResolvedValue({
      id: 'researchnote-1',
      documentVersionId: 'documentversion-msft0',
      text: 'Revenue footnote checked.',
      createdAt: '2026-11-04T12:00:00Z',
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Fundamentals />
      </MemoryRouter>
    )
    await user.type(await screen.findByLabelText('Search companies'), 'micro')
    await user.click(await screen.findByRole('button', { name: /MICROSOFT CORP/ }))
    await waitFor(() => expect(screen.getByText('246000')).toBeVisible())
    await user.type(screen.getByLabelText('Snapshot label'), 'Why I believe this')
    await user.click(screen.getByRole('button', { name: 'Save research snapshot' }))
    await waitFor(() => expect(screen.getByText(/Why I believe this · 3 facts/)).toBeVisible())
    await user.type(screen.getByLabelText('Note'), 'Revenue footnote checked.')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(screen.getByText(/Revenue footnote checked\./)).toBeVisible())
    expect(screen.getByText(/Other asset classes:/)).toBeVisible()
  })

  it('imports a company by CIK through the durable ingestion flow', async () => {
    vi.mocked(researchClient.ingest).mockResolvedValue({} as never)
    vi.mocked(researchClient.runNextIngestion).mockResolvedValue({
      job: { status: 'completed' },
    } as never)
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Fundamentals />
      </MemoryRouter>
    )
    await user.type(await screen.findByLabelText('CIK'), '320193')
    await user.click(screen.getByRole('button', { name: 'Import from EDGAR' }))
    await waitFor(() => expect(screen.getByText('Company imported from SEC EDGAR.')).toBeVisible())
    expect(vi.mocked(researchClient.ingest).mock.calls[0][1]).toBe('320193')
  })
})
