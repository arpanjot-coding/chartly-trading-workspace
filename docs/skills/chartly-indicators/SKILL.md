---
name: chartly-indicators
description: Write a custom indicator (or port a study from TradingView/another platform) for the Chartly charting terminal. Use when asked to create, port, modify or debug a Chartly chart indicator, overlay, oscillator, band or on-chart signal. Produces ONE plain-JavaScript file the user pastes into Chartly Settings > Custom Indicators (or saves via the Chartly MCP tools / into strategies/indicators/). This is the JavaScript chart path, not a Python strategy.
---

# Chartly custom chart indicators

You write ONE plain-JavaScript file. No TypeScript, no JSX, no imports,
no build step. The chart loads it at runtime and it appears in the
indicator picker under **Custom**, with a generated settings dialog.

## How the user installs your output (tell them, every time)

1. Chartly → Settings → **Custom Indicators** → New (or open the file).
2. Paste your file, press **Validate** (must pass), then **Save**.
3. Open the chart → Indicators → **Custom** → pick it. No restart.
   Edits are picked up the next time the picker opens.

If the Chartly MCP server is connected instead: call
`list_custom_indicators` first (never overwrite a name blindly), show
the user the full source, then `save_custom_indicator` (it asks the
user to confirm). The file lands in the same place either way.

## The contract (everything else follows from this)

The file default-exports a function. The chart calls it once with its
API. Inside, call `registerIndicator` one or more times.

```js
export default function ({ registerIndicator, sourceValues }) {
  registerIndicator({
    id: 'my-sma',            // unique registry key, kebab-case
    name: 'My SMA',          // picker + legend label
    category: 'Custom',      // keep 'Custom' unless told otherwise
    placement: 'onchart',    // 'onchart' overlays price; 'pane' = own pane
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
```

Facts that are easy to get wrong:

- A bar is `{ time, open, high, low, close, volume }`; `time` is
  **UTC seconds**, never milliseconds, never local time.
- `calc` returns **one array per plot key, exactly `bars.length`
  long**, `null` for warmup. `null`/`undefined`/`NaN` are gaps.
  **`0` is not a gap** — a 0 in warmup drags the pane scale to zero.
  A short array or a missing key draws nothing and errors nowhere.
- Every input needs a `default`. Input types: `number` (min/max/step),
  `boolean`, `color`, `text`, `select` (`options: [{label, value}]`),
  `source` (price source dropdown). Do NOT add colour/width inputs —
  the chart generates style controls from each plot's `style`.
- Plot types: `line`, `line-markers`, `step`, `area`, `histogram`,
  `column`. A plot `key` must match a key `calc` returns.
  `colorBy({ value, index, values, settings })` colours histogram/
  column bars per bar. `priceScaleId` gives a plot its own axis.
- `calc` runs on every data change — single pass, O(n). Read settings
  defensively: a cleared field arrives as `''`, so
  `Number(settings.length)` can be `0`/`NaN`; clamp it.
- Optional descriptor fields: `levels(settings)` horizontal lines,
  `range(settings)` fixed pane range (e.g. `{min: 0, max: 100}`),
  `markers(ctx)` bar-anchored signal labels, `fills` shading between
  two plots, `table(ctx)` corner summary grid, `calcTail(...)`
  incremental live recompute, `attach(ctx)` lifecycle for own data.
- Helpers you may receive in the API object include `sourceValues`
  (extract a price series: open/high/low/close/hl2/hlc3/ohlc4) plus
  series math the host exposes. Use only what the examples in the
  app's docs (`docs/custom-indicators.md`) use; do not invent helper
  names — implement the math yourself if unsure.

## Porting from Pine Script / other platforms

- Map `ta.sma(src, n)` etc. to explicit single-pass loops; there is
  no `ta.*` library here. Keep running sums/state in local variables.
- Pine's `na` = `null` here. Pine series indexing `src[1]` (previous
  bar) is `src[i - 1]` inside your loop — you always work forward.
- `plotshape`/labels become a `line-markers` plot or `markers(ctx)`;
  `bgcolor` regime shading becomes a `fills`/histogram trick or a
  step plot — say which you chose and why.
- Session logic: derive UTC day/session from `bar.time` with
  `new Date(bar.time * 1000)` UTC getters only.

## Safety rules (non-negotiable)

- A custom indicator runs **unsandboxed on the user's trading app
  origin**. Never emit code that fetches URLs, reads localStorage,
  touches the DOM outside the indicator API, or places orders. Pure
  math in, plot arrays out.
- Never overwrite an existing file name without the user explicitly
  asking; suggest a new file name instead.
- Output the complete file in one code block, then 2–4 lines: what it
  plots, its inputs, and the install steps above. If any behaviour
  from the original study cannot be represented, say so plainly
  instead of approximating silently.

## Self-check before handing over

1. Default export is a function; `registerIndicator` called with
   unique `id`, `name`, `category: 'Custom'`, valid `placement`.
2. Every input has `key`, `type`, `label`, `default`.
3. Every plot key is returned by `calc`, arrays `bars.length` long,
   warmup is `null`, divisions guard against 0/NaN lengths.
4. No imports, no TypeScript syntax, no network/DOM/order code.
5. File name suggestion is plain: letters/digits/`_-.`, ends `.js`
   (e.g. `session_vwap_bands.js`).
