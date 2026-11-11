# Replay costs and leverage — extension design, not implemented authority

The user's P07 workflow review identified unrealistic profile setup and requested credible spreads and leverage. The delivered creation correction requires actual owned history, explicit source currency, valid initial capital, optional session tags and run-specific reporting. Existing P06 execution remains fixed spread/slippage ticks, fees and one-times linear collateral. An instrument multiplier describes the contract; it is not leverage.

## Required inputs before enabling another model

Historical OHLC does not reveal the bid/ask spread or its intrabar path. A credible spread model needs either timestamped bid/ask observations with declared source availability and coverage, or a clearly labelled synthetic schedule. The app must not claim it knows historical spread from a session label. London/New York are optional tags, not source clocks, entitlements or automatic fee rules.

The first extension should pin a versioned cost-model revision in every run manifest. Modes would be observed bid/ask, reviewed constant ticks, or reviewed synthetic time/session schedule. Each lookup uses information available at the decision time and preserves missing observations as unknown. Time zones, DST transitions, session overlaps, news windows and overnight closures require explicit calendar policy. A synthetic schedule may widen reviewed baseline costs at selected periods; its parameters remain user assumptions, not measured market truth.

Leverage needs a separate versioned account model: position notional and margin currency, contract economics, maximum leverage, initial/maintenance margin, fees/funding/swaps, available buying power, negative equity, stop-out/liquidation, partial reductions and adverse gap behavior. Broker/account product rules cannot be inferred from a profile label or copied from spot cash. Execution permission remains separate even in a leveraged simulator.

## Implementation order and pass conditions

1. Add source schemas and validated economic fixtures for one chosen linear product. Preserve old P06 manifests and replay byte determinism; unsupported products remain unavailable.
2. Add pure cost lookup over pinned observations or explicit schedule, with causal availability. Test missing bid/ask, zero/inverted quotes, DST, overlaps, widening and adverse spread gaps.
3. Add a pure leveraged account policy with independent arithmetic fixtures for long/short entry, partial/full exit, fees/funding, insufficient margin and forced close. Specify ordering where margin liquidation and protective brackets compete inside an ambiguous candle.
4. Extend reports with declared versus observed costs, used/free margin, liquidation events, exposure and unsupported ratios. Exactly-once journal facts must preserve these event types without counting transfers as trading profit.
5. Add explicit reviewed controls to the existing Paper session panel only after the engine applies them. Verify restart, old/new policy coexistence, branch isolation, full restore, deterministic repeats and actual original-screen journeys.

Until those conditions pass, the UI must show the existing supported 1× model and reviewed costs rather than enable a decorative leverage selector or fabricated dynamic spread algorithm. No item here completes a future economic-model implementation task.
