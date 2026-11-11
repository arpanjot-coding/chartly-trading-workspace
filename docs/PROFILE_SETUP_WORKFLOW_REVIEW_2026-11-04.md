# Profile, platform connection, and chart-data workflow review

Date: 2026-11-04  
Status: root-cause review and target workflow confirmed by the user

## Executive finding

The problem reported with profile **AA** is not one missing button. The
application grew with several valid subsystems, but their responsibilities are
presented as if they were one “broker setup”:

1. **Trading profile** — the workspace, chart, journal, reporting currency,
   strategy tags, and account ownership boundary.
2. **Platform/account connection** — the verified external account identity,
   read-only account sync, journal linking, and eventually execution.
3. **Chart market data** — candles used for analysis, paper trading, and
   replay. This is independent from the trading account.
4. **Execution destinations/copy preferences** — advanced routing preferences,
   currently exposed too early and confused with the basic account connection.
5. **Legacy streaming transport** — the old OpenAlgo websocket/API-key path.
   It is not the user's broker API key and must not be the default explanation
   shown for a new MT5 or exchange profile.

Profile creation asks for the profile type and descriptive details, then sends
Live profiles to a connections page. It never asks:

- which trading platform/account the profile is for;
- whether the user wants to connect now or later;
- which independent source supplies chart candles;
- what symbol, interval, and history range should be downloaded;
- what “ready” means before opening the chart.

That is why a user can create an MT5-intended profile, find a separate and
complex connections page, then open a chart that complains about an unrelated
Chartly API key.

## Confirmed target workflow

The user selected all recommended options:

- **Guided live-profile setup:** profile details → trading platform/account →
  independent chart-data source → review.
- **Fully independent data selection:** for example, MT5 can be the account
  platform while Binance, Dukascopy, MT5, or saved history supplies candles.
- **Explicit MT5 download:** verify the already-running terminal/account,
  choose symbol/timeframe/count, stage and review closed candles, save an
  immutable history version, then use it for chart/replay. New candles are an
  explicit refresh, never a silent background rewrite.

## Current flow and evidence

### 1. Profile creation has no platform or live-data decision

`TraderWorkspace.tsx` presents a three-step dialog:

1. Choose Live or Replay.
2. Name, sessions, timezone, currency, strategy, default symbol/timeframe.
3. Setup & review.

Replay gets a real data choice in step 3: an owned saved-history version is
required and stored as `chartSource: { kind: 'dataset', ... }`.

Live gets no equivalent choice. On submit:

- `createPortfolio` stores only descriptive profile fields;
- a dataset `chartSource` is attached only for Replay;
- Live navigates to `/workspace/profiles/:id/connections`.

There is no platform/account field in `TraderPortfolio`. Its only source field
is `ProfileChartSource = dataset | connected`, where “connected” has no
provider, account, connection, symbol, or market-data identity. That type is
too vague to drive a professional setup or a useful status page.

### 2. Two account systems are shown as one connections workflow

The profile Connections page contains two different models:

#### A. Verified connector connections

`ConnectorPanel` uses the backend connector framework:

- provider catalog and categories;
- a connection record optionally scoped to `profileId`;
- encrypted credentials where applicable;
- probe/verification;
- observed account identity;
- capability reporting;
- journal-book linking;
- bounded account-history reads.

This is the correct foundation for Binance, Bybit, Coinbase, MT5, TopstepX,
Alpaca, and later NinjaTrader/TradeStation/cTrader/IBKR.

#### B. Local saved accounts, terminals, and destinations

The same page also contains browser/workspace records:

- manually typed broker accounts;
- manually typed terminals;
- profile destinations;
- copy sizing, delay, noise, comments, drawdown preferences;
- `isChartDataSource` as a preference flag.

Those records do **not** connect to a broker, verify an account, stream data,
or place orders. The page now demotes them under “Advanced saved settings,”
which helps, but profile overview still treats “add a destination” and
“choose which destination supplies chart data” as setup tasks. Worst of all,
setting `isChartDataSource` does not make candles reach `Trading.tsx`; it is
only displayed as a preference.

So a user can reasonably believe they have “set up MT5” while the chart has
received neither a verified connector identity nor a candle dataset.

### 3. Chart resolution treats every non-dataset profile as legacy-connected

`chartContext.ts` resolves only:

- `dataset`
- `legacy-connected`
- `missing`

A Live profile without a dataset therefore becomes `legacy-connected` by
default. `Trading.tsx` then tries to fetch:

- `/api/websocket/apikey`
- `/api/websocket/config`

That API key is Chartly's own legacy websocket credential, generated at
`/apikey`. It is not an MT5 credential and not a Binance/Bybit/etc. API key.
The websocket proxy's supported adapters came from the removed Indian-broker
stack, so even generating this key would not make MT5 candles appear.

Similarly, `brokerConnected` in `Trading.tsx` is derived from the legacy auth
store (`user.broker`), not from a profile-scoped verified connector record.
“Connected” therefore means at least three unrelated things in the codebase.

### 4. “Chart data source” only really means saved datasets

The chart source picker is titled generally, but its implementable choices are
saved dataset versions or “existing connected data.” New keyless feeds and MT5
terminal candles live behind History & Data import, not in the Live profile
setup path.

That separation at the data-integrity layer is correct — replay needs an
immutable, reviewed, checksummed history version — but the user journey hides
it. Professional UX should expose the download inside setup while preserving
the same preview → review → publish integrity gates.

### 5. MT5 has three separate truths that the UI merges

For MT5, Chartly deliberately:

- attaches only to an already-running, already-logged-in terminal;
- never asks for or stores the terminal password;
- checks terminal/account identity through the connector;
- treats terminal timestamps as broker-server epoch until verified.

Account verification, account history, terminal quotes, and terminal candles
are different capabilities. The UI must show them as separate statuses rather
than one green “MT5 connected” claim.

MT5 candle timestamps need extra care: raw bar times are broker-server epoch,
measured at roughly UTC+2 on the current demo terminal. The connector reports
the measured skew and does not silently convert. Dataset staging may apply an
explicit hour-rounded conversion only when that conversion is recorded in the
dataset observation and reviewed by the user; otherwise staging must fail
closed.

### 6. Naming increases the confusion

The same words currently mean different things:

| Term | Meanings found in the app |
|---|---|
| Profile | trading workspace; also user account; also chart indicator profile |
| Account | local app account, manually saved broker label, verified external account, journal book account |
| Connection | backend connector record, saved manual record, legacy broker login, websocket connection |
| Data source | saved dataset, destination flag, public feed, account-history source |
| Terminal | desktop trading terminal and the internal chart terminal component |
| API key | venue credential and Chartly's legacy websocket credential |

The redesign should use precise labels everywhere:

- **Trading platform/account** for external account identity and (future)
  execution.
- **Chart data** for candles.
- **Saved history version** for immutable replay/chart data.
- **Account history** for deals/orders/fills, never “history” alone when
  candles are meant.
- **Legacy streaming key** for `/apikey`, only in advanced/developer contexts.

## Target information architecture

### Live profile creation — four steps

#### Step 1: Profile type

Live trading or Replay project. Type remains fixed after creation.

#### Step 2: Profile details

Name, reporting currency, timezone, sessions/strategy tags, default symbol
and timeframe, optional mindset tracking.

#### Step 3: Platform and chart data — two independent cards

**A. Trading platform/account**

- Connect a platform now, connect later, or journal-only.
- Category → provider → connection name.
- Planned providers are visibly planned and cannot be submitted as working.
- After profile creation, Chartly opens the provider's verify step with the
  chosen provider/name already selected.
- Account connection does not claim order support unless that provider has a
  certified execution path.

**B. Chart data**

- Download candles now, use existing saved history, or decide later.
- Download providers are independent from A: MT5 terminal, Binance, Bybit,
  Coinbase, OKX, Bitget, Dukascopy, and other supported feeds.
- Symbol and timeframe are venue-native; no silent cross-venue symbol
  translation.
- Fetch produces a preview with provider, symbol, interval, closed-candle
  count, coverage, excluded unfinished candle, and time-basis notes.
- User explicitly reviews before the history version is published and pinned
  to the new profile.

#### Step 4: Review and next action

Show separately:

- Profile
- Trading platform/account: selected / later / journal-only
- Chart data: downloaded version / selected version / not set up
- Next action: Verify platform account, Open chart, or Finish chart-data setup

### Profile overview

A live profile should open with a setup/status area containing separate,
truthful rows:

1. **Trading account** — Not selected / Connection created / Verification
   needed / Verified read-only / Journal linked / Execution certified.
2. **Chart data** — Not selected / Download staged / Saved version pinned
   (provider, symbol, interval, coverage, fetched at).
3. **Replay readiness** — Ready when a saved history version exists; live
   account status is irrelevant.
4. **Execution** — unavailable until a provider-specific certified order path
   exists; never inferred from account linking or data download.

### Connections page

Keep `ConnectorPanel` as the front door, renamed in copy to **Trading
platforms & accounts**. It should not be described as the place where chart
candles are loaded.

Manual broker-account/terminal/destination records remain available only as
**Advanced saved routing preferences**. They must never be prerequisites in
the main setup checklist.

### History & Data

Remains the system of record for:

- importing CSV/bundles;
- downloading public/terminal candles;
- reviewing quality/coverage;
- publishing immutable saved versions;
- explicitly refreshing a feed into a new version.

Profile setup should reuse the same backend preview/commit path rather than a
second importer.

### Trading chart empty states

For a profile with no pinned dataset, the chart must not lead with the legacy
API-key message. It should say, in substance:

> Chart data is not set up for this profile. Trading-account connection and
> chart candles are separate. Download candles or choose saved history to
> chart here. Connecting MT5/Binance/etc. verifies the account; it does not
> by itself publish candle history.

Primary actions:

- Download / choose chart data
- Open History & Data
- Set up trading platform

The Chartly legacy streaming key belongs only behind an advanced explanation
for the legacy connected-stream mode.

## Data-model direction

Add explicit setup intent to the profile without overloading `chartSource`:

```ts
liveSetup?: {
  version: 1
  account: {
    mode: 'connector' | 'later' | 'journal-only'
    providerId?: string
    providerName?: string
    category?: string
    connectionLabel?: string
  }
  chartData: {
    mode: 'saved-history' | 'download' | 'later'
    providerId?: string
    providerName?: string
    symbol?: string
    interval?: string
    datasetVersionId?: string
  }
}
```

`chartSource` remains the actual chart binding. A selected platform in
`liveSetup` is intent, not proof of verification. Actual verification remains
the backend connector record; actual candles remain the dataset version.

## Repair path for existing profiles (including AA)

Existing profiles must not be stranded:

- Profile overview/settings expose the same Platform and Chart data choices.
- The chart offers “Download / choose chart data” in place.
- Connections opens with the profile's chosen provider preselected when setup
  intent exists.
- Pinning a saved history version makes the existing chart/replay machinery
  work without recreating the profile.

## Acceptance checks

The redesign is complete only when a fresh user can, without guessing:

1. Create a Live profile and select **MetaTrader 5** during creation.
2. See that account verification is a distinct next step.
3. Independently choose **MT5 terminal** (or another feed) for candles.
4. Download EURUSD candles, review count/coverage/time basis, and publish.
5. Open the chart and see those candles — with no Chartly websocket API key.
6. Start from the existing AA profile and complete the same data setup.
7. Create a journal-only Live profile without being forced to fake a broker.
8. Create a Replay project with the same saved history and no account
   connection.
9. See execution described as unavailable until separately certified.

## Implementation order

1. Finish MT5 as a market-feed/data-library provider with explicit time-basis
   handling and tests.
2. Add profile `liveSetup` intent and provider-prefill support in
   `ConnectorPanel`.
3. Rebuild Live creation as four steps with independent platform/data cards.
4. Reuse feed preview/commit inside setup and pin the resulting dataset.
5. Replace profile overview checklist and Trading empty state with separated
   statuses/actions.
6. Browser-test new-profile MT5 flow and repair of profile AA.
