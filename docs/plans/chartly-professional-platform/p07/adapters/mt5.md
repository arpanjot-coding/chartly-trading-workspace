# MetaTrader 5 read-only subplan and access record

Owner: Chartly maintainers. Adapter `mt5`, version `p07-read-only-v1`; local Windows terminal transport. The operator authorized read-only attachment to the already logged-in selected demo terminal. No password was needed or copied. [Access proof](../evidence/mt5-read-only-access.json), [production conformance](../evidence/mt5-read-only-conformance.json), [native resource audit](../evidence/mt5-native-resource-audit.json).

## Delivered scope

The actual SDK was `MetaTrader5 5.0.6231` on Windows/Python 3.14.7, terminal build 6296. The selected `C:/Program Files/MetaTrader 5/terminal64.exe` was running; observed server/environment/currency were MetaQuotes-Demo / broker_demo / GBP. Portable evidence masks the account and retains only an identity checksum. Native reads confirmed unchanged identity before/after access, one raw balance-type deal in the seven-day access window, EURUSD point/contract/volume economics, a current bid/ask observation and five provider-closed M1 bars.

Production conformance passed 17 checks for account read and bounded raw history. There is no login, order submission, order checking, symbol selection or terminal-setting mutation. Missing SDK, stopped/unselected terminal, changed login/server/currency/environment, offline IPC, malformed response and excessive history are actionable failures. The Python attachment shuts down in `finally`; the user's terminal is not closed.

## Time and accounting boundary

The observed quote/bar epochs were approximately two hours ahead of host UTC. No offset was guessed or applied. `marketLive` and `marketHistory` therefore remain unknown with `provider_clock_unverified`; a successful read is not UTC-aligned chart-data certification. Current bid/ask is not historical replay spread.

Raw deal observations preserve native provider timestamps in their payload and use explicit receipt-only occurrence metadata. Coverage stays incomplete and cannot advance a verified UTC high-water mark. Broad MT5 fill grouping, netting/hedging, fees/funding, account-currency conversions and journal projection remain unverified P09 work; the one observed balance deal proves none of those. No raw MT5 row becomes a fabricated closed journal trade.

History transport uses at most one day per page, at most 200 native rows, context-bound cursors and at most 31 days per requested window. A count above 200 requires a smaller window before allocating deal rows. SDK calls have a five-second initialization timeout, selected-process checks and a bounded attachment lock. No automatic heartbeat thread or retry loop is started. A terminal disappearing between process check and the upstream initializer is an upstream race; the app implements no deliberate launch or account switch.

## Official references and next certification

MetaQuotes documents [initialization](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py), [account identity](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py) and [history deals](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py). Initialization can use saved terminal credentials and can launch a terminal when required, so the adapter requires the selected running executable and never supplies login/password/server changes.

P09 must establish a reviewed broker-time/calendar policy, multi-period coverage, native symbol/quantity/protection semantics and representative executions/corrections before promoting those capabilities. New account/server/environment, SDK/build changes, changed permissions or clock behavior require fresh evidence. This record certifies no live execution, native protection, copying or bots.
