import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleCheck,
  Database,
  FileSpreadsheet,
  GitBranch,
  Layers3,
  LineChart,
  Monitor,
  PencilRuler,
  Play,
  ShieldCheck,
  TimerReset,
} from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { publicGuides } from '@/config/publicPages'
import './home.css'

const sections = [
  { id: 'paper-trading', label: 'Paper & replay', short: 'Replay' },
  { id: 'live-trading', label: 'Live trading', short: 'Live' },
  { id: 'journal', label: 'Journal', short: 'Journal' },
  { id: 'connections', label: 'Data & connections', short: 'Data' },
  { id: 'workflows', label: 'Workflows', short: 'Workflows' },
]

const chartTools = [
  {
    icon: LineChart,
    title: 'Indicators you can combine',
    text: 'Overlay an EMA on price and place an RSI below the chart. Add more studies or compare timeframes as you work.',
  },
  {
    icon: PencilRuler,
    title: 'Mark your setup',
    text: 'Draw support and resistance, label a planned entry, and attach chart evidence to your trade review.',
  },
  {
    icon: Layers3,
    title: 'Work across layouts',
    text: 'Use multiple chart panes and switch symbols, intervals, or data sources from the chart controls.',
  },
]

const replaySteps = [
  [
    'Choose your history',
    'Import candles, select the symbol and period, and create a replay project.',
  ],
  [
    'Run the setup',
    'Step one candle at a time or play forward. Place simulated orders with your own starting balance and cost settings.',
  ],
  [
    'Review the result',
    'Compare entries, exits, fills, and P&L in a run report. Keep each run separate so you can repeat the same setup.',
  ],
]

const connectionOptions = [
  {
    icon: Database,
    title: 'Saved market history',
    text: 'Import candle CSVs into the Data Library. Reuse a dataset for charting or choose it as the source for a paper run.',
  },
  {
    icon: Monitor,
    title: 'MetaTrader 5 on Windows',
    text: 'Use a running, signed-in terminal. If you use separate MT5 installations, verify and link each account to its own live profile.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Statements and other providers',
    text: 'Import trade statements into a journal or connect a supported feed. Check what a provider offers for prices, history, or account access.',
  },
]

const questions = [
  {
    question: 'Can I start without a broker account?',
    answer:
      'Yes. Create a manual journal book to log or import trades. For replay, import saved candle history first. A trade statement alone cannot reconstruct a market session.',
  },
  {
    question: 'Can I backtest a strategy in Chartly?',
    answer:
      'Paper replay supports manual backtesting. Move through recorded candles, apply your entry and exit rules, and review simulated results with your chosen costs. The replay workflow does not automatically optimise a strategy.',
  },
  {
    question: 'How does the MetaTrader 5 connection work?',
    answer:
      'Chartly uses an already signed-in MT5 terminal on the same Windows machine. Verify the account and link it to a live profile. Charts and account views depend on the connected terminal and its permissions.',
  },
  {
    question: 'Does Chartly include a market data subscription?',
    answer:
      'Chartly is self-hosted. You can bring your own history or connect a supported provider. Coverage, access, and any market data costs depend on that provider.',
  },
]

export function Brand() {
  return (
    <Link to="/" reloadDocument className="product-home-brand" aria-label="Chartly home">
      <img src="/images/chartly-mark.svg" width="36" height="36" alt="" />
      Chartly
    </Link>
  )
}

export function OpenWorkspace({ compact = false }: { compact?: boolean }) {
  return (
    <Button asChild size={compact ? 'default' : 'lg'} className="product-home-primary">
      <Link to="/workspace">
        Open workspace <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <p className="product-home-label">{children}</p>
}

export function ProductPreview({
  src,
  title,
  detail,
  width = 1440,
  height,
  description,
  priority = false,
}: {
  src: string
  title: string
  detail: string
  width?: number
  height: number
  description: string
  priority?: boolean
}) {
  return (
    <figure className={`product-home-preview${priority ? ' product-home-preview--hero' : ''}`}>
      <figcaption>
        <span className="product-home-preview-title">
          <span className="product-home-preview-dot" aria-hidden="true" />
          {title}
        </span>
        <span className="product-home-preview-detail">{detail}</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} screenshot in a new tab`}
          title="Open full-size screenshot"
        >
          <ArrowUpRight aria-hidden="true" />
        </a>
      </figcaption>
      <div className="product-home-preview-screen">
        <img
          src={src}
          width={width}
          height={height}
          alt={description}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
        />
      </div>
    </figure>
  )
}

export default function Home() {
  return (
    <div className="product-home">
      <a href="#home-main" className="product-home-skip">
        Skip to content
      </a>
      <header className="product-home-header">
        <div className="product-home-wrap product-home-nav-row">
          <Brand />
          <nav className="product-home-nav" aria-label="Product navigation">
            {sections.map(({ id, label, short }) => (
              <a key={id} href={`#${id}`} aria-label={label}>
                <span className="product-home-nav-full">{label}</span>
                <span className="product-home-nav-short" aria-hidden="true">
                  {short}
                </span>
              </a>
            ))}
          </nav>
          <OpenWorkspace compact />
        </div>
      </header>

      <main id="home-main" tabIndex={-1}>
        <section id="charts" className="product-home-hero" aria-labelledby="home-title">
          <div className="product-home-wrap product-home-hero-inner">
            <div className="product-home-hero-copy">
              <SectionLabel>Self-hosted trading workspace</SectionLabel>
              <h1 id="home-title">
                Chart the market. <span>Practise before you trade.</span>
              </h1>
              <p className="product-home-lead">
                Follow a live account or practise with saved market data. Use the same chart tools
                and keep every trade in the right journal book.
              </p>
              <div className="product-home-actions">
                <OpenWorkspace />
                <Button asChild variant="outline" size="lg" className="product-home-secondary">
                  <a href="#paper-trading">
                    Explore paper replay <ArrowDown aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>

            <ProductPreview
              src="/images/product/chartly-landing-chart.png"
              title="Chart workspace"
              detail="BTCUSD · 15 min · Sample history"
              width={1740}
              height={810}
              description="Chartly candlestick chart with EMA and RSI indicators, a horizontal level, and a labeled sample entry"
              priority
            />
            <ul className="product-home-chart-tools" aria-label="Chart tools">
              {chartTools.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <Icon aria-hidden="true" />
                  <div>
                    <h2>{title}</h2>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              to="/guides/chart-indicators"
              reloadDocument
              className="product-home-text-link product-home-chart-guide"
            >
              Set up chart indicators <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section
          id="paper-trading"
          className="product-home-wrap product-home-section"
          aria-labelledby="paper-title"
        >
          <div className="product-home-section-heading">
            <SectionLabel>Paper trading & replay</SectionLabel>
            <h2 id="paper-title">Backtest a setup candle by candle.</h2>
            <p>
              Return to a market session and practise with a paper account. Replay lets you test
              your entry and exit rules as the next candle arrives.
            </p>
          </div>
          <div className="product-home-replay-stage">
            <Tabs defaultValue="paper" className="product-home-paper-tabs">
              <TabsList className="product-home-tabs-list" aria-label="Paper and replay preview">
                <TabsTrigger value="paper">Paper account</TabsTrigger>
                <TabsTrigger value="replay">Replay controls</TabsTrigger>
              </TabsList>
              <TabsContent value="paper">
                <ProductPreview
                  src="/images/product/chartly-paper.png"
                  title="Paper trading account"
                  detail="BTCUSD · Sample run"
                  height={920}
                  description="BTCUSD replay chart with an isolated paper account, balances, and a simulated order ticket"
                />
              </TabsContent>
              <TabsContent value="replay">
                <ProductPreview
                  src="/images/product/chartly-replay.png"
                  title="Candle replay"
                  detail="BTCUSD · Saved session"
                  height={875}
                  description="Chart replay showing historical candles, a time scrubber, and controls for stepping through the session"
                />
              </TabsContent>
            </Tabs>
            <aside className="product-home-paper-notes" aria-label="Paper account controls">
              <TimerReset aria-hidden="true" className="product-home-feature-icon" />
              <h3>A paper account for every run</h3>
              <ul className="product-home-checks">
                <li>
                  <CircleCheck aria-hidden="true" /> Starting balance and currency
                </li>
                <li>
                  <CircleCheck aria-hidden="true" /> Spread, slippage, and fees
                </li>
                <li>
                  <CircleCheck aria-hidden="true" /> Simulated orders, fills, and positions
                </li>
                <li>
                  <CircleCheck aria-hidden="true" /> Run results and trade review
                </li>
              </ul>
              <p>Paper orders stay in the simulation.</p>
            </aside>
          </div>
          <ol className="product-home-steps" aria-label="Replay workflow">
            {replaySteps.map(([title, text]) => (
              <li key={title}>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link to="/guides/backtesting-software" reloadDocument className="product-home-text-link">
            Read the manual backtesting guide <ArrowRight aria-hidden="true" />
          </Link>
        </section>

        <section id="live-trading" className="product-home-live-band" aria-labelledby="live-title">
          <div className="product-home-wrap product-home-split product-home-section">
            <div className="product-home-section-heading">
              <SectionLabel>Live trading</SectionLabel>
              <h2 id="live-title">Chart with your account in view.</h2>
              <p>
                Connect a supported account to a live profile. With MetaTrader 5 on Windows, link an
                already signed-in terminal and pull its symbols and account data into Chartly.
              </p>
              <ul className="product-home-checks">
                <li>
                  <CircleCheck aria-hidden="true" /> Search the terminal’s broker-specific symbols.
                </li>
                <li>
                  <CircleCheck aria-hidden="true" /> View balances, open positions, and working
                  orders.
                </li>
                <li>
                  <CircleCheck aria-hidden="true" /> Keep each verified account in its own live
                  profile.
                </li>
              </ul>
              <p className="product-home-scope-note">
                This MT5 preview shows read-only account data. Order entry depends on the connector
                and account permissions.
              </p>
              <Link to="/guides/mt5-charts" reloadDocument className="product-home-text-link">
                Set up MT5 charts <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <ProductPreview
              src="/images/product/chartly-mt5.png"
              title="MetaTrader 5 account view"
              detail="EURUSD · Illustrative positions"
              width={1600}
              height={920}
              description="EUR/USD chart with sample MetaTrader 5 balances, an EMA, a sample entry label, and a read-only positions table"
            />
          </div>
        </section>

        <section
          id="journal"
          className="product-home-wrap product-home-section"
          aria-labelledby="journal-title"
        >
          <div className="product-home-journal-head">
            <div className="product-home-section-heading">
              <SectionLabel>Trade journal</SectionLabel>
              <h2 id="journal-title">Every account gets its own book.</h2>
              <p>
                Log trades manually, import a statement, or sync where supported. Open a trade from
                its book to inspect the chart, then return to the same book and filters.
              </p>
            </div>
            <div className="product-home-journal-note">
              <BookOpen aria-hidden="true" />
              <div>
                <h3>Review at the right level</h3>
                <p>
                  Filter a book by strategy or time period, or choose which portfolios to compare in
                  Combined Analysis.
                </p>
              </div>
            </div>
          </div>
          <Tabs defaultValue="overview" className="product-home-journal-tabs">
            <TabsList className="product-home-tabs-list" aria-label="Journal preview">
              <TabsTrigger value="overview">Book overview</TabsTrigger>
              <TabsTrigger value="trades">Trade log</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <ProductPreview
                src="/images/product/chartly-journal.png"
                title="Journal overview"
                detail="12 sample trades"
                height={1070}
                description="Trade Journal showing book filters, review tabs, and metrics from sample trades"
              />
            </TabsContent>
            <TabsContent value="trades">
              <ProductPreview
                src="/images/product/chartly-journal-trades.png"
                title="Trade log"
                detail="Sample trade history"
                height={1070}
                description="Journal trade log with sample entries, strategies, and trade results"
              />
            </TabsContent>
          </Tabs>
        </section>

        <section
          id="connections"
          className="product-home-data-band"
          aria-labelledby="connections-title"
        >
          <div className="product-home-wrap product-home-data-grid product-home-section">
            <div className="product-home-section-heading">
              <SectionLabel>Connections & data</SectionLabel>
              <h2 id="connections-title">Start with the data you have.</h2>
              <p>
                Choose the source that fits the job. Chart history and account activity can come
                from different places.
              </p>
              <Link to="/settings/connections" className="product-home-text-link">
                Open connections <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <ul className="product-home-source-list">
              {connectionOptions.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <Icon aria-hidden="true" className="product-home-feature-icon" />
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="workflows"
          className="product-home-wrap product-home-section"
          aria-labelledby="automation-title"
        >
          <div className="product-home-workflows">
            <div className="product-home-section-heading">
              <SectionLabel>Workflows</SectionLabel>
              <h2 id="automation-title">Automate the steps you repeat.</h2>
              <p>
                Build a workflow around an alert, schedule, or webhook. Review approvals and see
                what ran from Automation.
              </p>
              <Link to="/flow" className="product-home-text-link">
                Open automation <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <ol className="product-home-flow" aria-label="Example automation flow">
              <li>
                <Play aria-hidden="true" />{' '}
                <span>
                  <strong>Trigger</strong> Alert, schedule, or webhook
                </span>
              </li>
              <li>
                <GitBranch aria-hidden="true" />{' '}
                <span>
                  <strong>Conditions</strong> Decide when to continue
                </span>
              </li>
              <li>
                <ShieldCheck aria-hidden="true" />{' '}
                <span>
                  <strong>Review</strong> Approvals and execution history
                </span>
              </li>
            </ol>
          </div>
        </section>

        <section className="product-home-guide-band" aria-labelledby="guides-title">
          <div className="product-home-wrap product-home-guide-index">
            <h2 id="guides-title">Chartly guides</h2>
            <ul>
              {Object.entries(publicGuides).map(([slug, guide]) => (
                <li key={slug}>
                  <Link to={`/guides/${slug}`} reloadDocument>
                    {guide.label} <ArrowRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="faq"
          className="product-home-wrap product-home-faq"
          aria-labelledby="faq-title"
        >
          <div className="product-home-section-heading">
            <SectionLabel>Getting started</SectionLabel>
            <h2 id="faq-title">Before you open a workspace.</h2>
          </div>
          <div className="product-home-questions">
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="product-home-wrap product-home-closing" aria-labelledby="closing-title">
          <div className="product-home-closing-inner">
            <div>
              <h2 id="closing-title">Start with a chart.</h2>
              <p>Choose a live profile, a replay project, or a standalone journal.</p>
            </div>
            <OpenWorkspace />
          </div>
        </section>
      </main>

      <footer className="product-home-footer">
        <div className="product-home-wrap product-home-footer-row">
          <Brand />
          <nav aria-label="More about Chartly">
            <a href="#charts">Charts</a>
            <a href="#workflows">Workflows</a>
            <a href="#faq">FAQ</a>
            <Link to="/faq">
              App help <ArrowUpRight aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
