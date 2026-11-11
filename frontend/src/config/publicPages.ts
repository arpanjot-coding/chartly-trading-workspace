type PageMetadata = {
  title: string
  description: string
  image: string
  imageAlt: string
}

type GuideSection = {
  heading: string
  text: string
  steps?: string[]
}

type Guide = PageMetadata & {
  heading: string
  label: string
  summary: string
  imageWidth: number
  imageHeight: number
  imageCaption: string
  sections: GuideSection[]
  sources?: { label: string; url: string }[]
}

export const homeMetadata = {
  title: 'Chartly | Manual Backtesting, Paper Trading & MT5 Charts',
  description:
    'Chartly is a self-hosted trading workspace for manual strategy backtesting, paper trading with candle replay, MT5 charts, indicators, and trade journals.',
  image: '/images/product/chartly-landing-chart.png',
  imageAlt: 'Chartly candlestick chart with EMA, RSI, and a sample entry annotation',
} satisfies PageMetadata

export const publicGuides: Record<string, Guide> = {
  'backtesting-software': {
    title: 'Manual Backtesting Software & Strategy Replay | Chartly',
    description:
      'Test a trading strategy candle by candle with Chartly. Import historical market data, practise with a paper account, and review simulated fills and P&L.',
    heading: 'Manual backtesting with candle replay',
    label: 'Manual backtesting',
    summary:
      'Use saved market data to test a strategy as you would trade it. Step through candles, make decisions with the data visible at the time, and record the result in a separate paper account.',
    image: '/images/product/chartly-paper.png',
    imageAlt: 'A BTCUSD replay chart beside a paper account and simulated order ticket',
    imageWidth: 1440,
    imageHeight: 920,
    imageCaption: 'Sample BTCUSD paper account and order ticket',
    sections: [
      {
        heading: 'Prepare a replay project',
        text: 'You need historical candles for the symbol and timeframe you want to test. Chartly’s Data Library can import candle CSVs. Use a dataset that covers the session you want to review.',
        steps: [
          'Import your candle history and check the symbol and interval.',
          'Open Workspace, create a replay project, and select the saved history.',
          'Start a paper run with the balance, currency, spread, slippage, and fees you want to model.',
        ],
      },
      {
        heading: 'Apply your trading rules in replay',
        text: 'Write down the conditions for an entry, the exit rule, and your position sizing before stepping forward. Use the chart’s drawings and indicators to mark the setup. Advance one candle at a time when you need to see how a signal develops.',
      },
      {
        heading: 'Review simulated fills and P&L',
        text: 'Use the run report to inspect entries, exits, fills, costs, and P&L. Start a separate run to compare a different rule or a different period. The replay workflow records decisions you make on the chart and results from the paper execution model.',
      },
    ],
  },
  'mt5-charts': {
    title: 'MetaTrader 5 Charts & Account Positions | Chartly',
    description:
      'Connect a signed-in MetaTrader 5 terminal on Windows to chart broker symbols and view MT5 balances, positions, and working orders in Chartly.',
    heading: 'MT5 charts with your account in view',
    label: 'MetaTrader 5 charts',
    summary:
      'Connect Chartly to a running MetaTrader 5 terminal on Windows. Open the broker’s symbols in the chart and inspect account balances, positions, and working orders alongside price.',
    image: '/images/product/chartly-mt5.png',
    imageAlt: 'An EURUSD chart with EMA, a sample entry label, and the MT5 positions table',
    imageWidth: 1600,
    imageHeight: 920,
    imageCaption: 'EURUSD chart with illustrative MetaTrader 5 positions',
    sections: [
      {
        heading: 'Link a signed-in MT5 terminal',
        text: 'Run Chartly and MetaTrader 5 on the same Windows machine. Chartly uses the terminal’s existing account session.',
        steps: [
          'Open MetaTrader 5 and sign in to the account you want to use.',
          'In Chartly, open Connections & Data and verify the MetaTrader 5 connection.',
          'Link it to a live profile and open the chart for that profile.',
        ],
      },
      {
        heading: 'Find the right broker symbol',
        text: 'Search using the instrument name or broker symbol. Some brokers add a prefix or suffix, so select the instrument returned by the verified terminal. Add indicators and drawings in the Chartly chart.',
      },
      {
        heading: 'Keep accounts tied to their profiles',
        text: 'A live profile uses its verified account for symbols and account data. If you use several MT5 installations, configure the approved terminal paths and link each account to its own live profile. Account features and order access depend on the connector and account permissions.',
      },
    ],
  },
  'chart-indicators': {
    title: 'Trading Chart Indicators, EMA & RSI | Chartly',
    description:
      'Use EMA, RSI, price levels, and multiple chart panes in Chartly. Build a chart setup and use it with saved candles, paper replay, or a supported feed.',
    heading: 'Trading chart indicators and drawings',
    label: 'Chart indicators',
    summary:
      'Overlay indicators on price, add studies in a separate pane, and annotate the levels you want to revisit in your trading journal.',
    image: '/images/product/chartly-landing-chart.png',
    imageAlt:
      'A Chartly chart with an EMA overlay, an RSI pane, a horizontal level, and a sample entry',
    imageWidth: 1740,
    imageHeight: 810,
    imageCaption: 'EMA and RSI on saved BTCUSD candles',
    sections: [
      {
        heading: 'Combine an overlay and a separate study',
        text: 'An exponential moving average (EMA) can sit on the candlestick chart while the relative strength index (RSI) occupies its own pane. This keeps price and the indicator’s scale readable.',
        steps: [
          'Open a chart with saved candles or a supported live feed.',
          'Use Indicators to search for EMA and add it to the price pane.',
          'Add RSI, then use the drawing toolbar to mark a price level or label a setup.',
        ],
      },
      {
        heading: 'Compare context across chart panes',
        text: 'Use a multi-pane layout to compare instruments or timeframes. Choose the symbol and data source for the chart you are working on.',
      },
      {
        heading: 'Use the chart in replay and trade review',
        text: 'Mark up a setup while you step through saved candles in paper replay. From the journal, open a trade on its chart to review the market context and return to the same book.',
      },
    ],
  },
  'tradingview-alternative': {
    title: 'TradingView Alternative for Self-Hosted Charts | Chartly',
    description:
      'Compare Chartly’s self-hosted charts, manual replay, MT5 connection, and journals with TradingView Bar Replay and Pine Script strategy testing.',
    heading: 'Chartly and TradingView for charting and replay',
    label: 'Chartly and TradingView',
    summary:
      'Compare the tools you would use for charting, testing a strategy, and reviewing trades. Start with the kind of testing you want to do and where your market data comes from.',
    image: '/images/product/chartly-journal.png',
    imageAlt: 'A Chartly journal book with sample trades, filters, and performance metrics',
    imageWidth: 1440,
    imageHeight: 1070,
    imageCaption: 'Chartly journal overview with sample trades',
    sections: [
      {
        heading: 'Manual replay and scripted strategy tests',
        text: 'TradingView documents Bar Replay for working through historical bars and Pine Script strategies for simulated backtesting and forward testing. Chartly’s paper replay is designed for manual tests. Import saved candles, step forward, enter simulated orders, and review the run.',
      },
      {
        heading: 'Market data and account setup',
        text: 'Chartly is self-hosted and uses saved candles or supported feeds. On Windows it can link to a signed-in MT5 terminal for account views and broker symbols. For TradingView, consult its documentation for the symbol, historical coverage, or broker you need.',
      },
      {
        heading: 'Review a trade from its journal',
        text: 'In Chartly, keep a journal book per account, import a statement or record trades manually, and open an individual trade on its chart. Compare the selected books in Combined Analysis when you want to review several portfolios.',
      },
    ],
    sources: [
      {
        label: 'TradingView Bar Replay documentation',
        url: 'https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/',
      },
      {
        label: 'TradingView Pine Script strategy documentation',
        url: 'https://www.tradingview.com/pine-script-docs/concepts/strategies/',
      },
    ],
  },
}

export function findPublicGuide(slug: string) {
  return Object.hasOwn(publicGuides, slug) ? publicGuides[slug] : undefined
}
