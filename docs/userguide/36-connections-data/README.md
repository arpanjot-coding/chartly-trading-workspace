# 36 - Connections & Data

Use **Settings → Connections & Data** or a profile's **Open → Connections** to
review its declared accounts and read-only connections. The original Workspace,
Chart, Journal and profile screens remain the base. A saved account label is
configuration. Observed identity, current health, available history and execution
permission each have their own status.

## Create the Intended Environment

Start in Workspace with **New profile**. The wizard has **Choose type**,
**Profile details** and **Setup & review** steps. Choose a live environment or
replay project once. Give it a name and explicit reporting currency. Session
tags can contain several presets or your own comma-separated labels; they never
change an explicitly chosen timezone. Strategy labels are optional. Symbol,
timeframe and timezone are defaults, and mindset tracking is optional.

A replay project requires owned saved history before creation. In **Saved
history version**, select a nonempty private version and review its provider,
instrument, native interval, range, quality and declared currency. The source's
symbol spelling, interval and currency remain attached to that version. Confirm
**I reviewed this history and its declared currency** before **Create profile**.
A connection label alone does not provide candles.

If history is missing, choose **Import or manage history**, import through the
[Data Library](../34-data-library/README.md), then return to the retained setup.
Use **Refresh history** or **Load more history versions** when needed. The
owner-scoped setup draft contains no credential. Switching the signed-in owner
clears the previous owner's choices and ignores their delayed responses.

**Default paper starting cash** must be a positive decimal with at most eight
decimal places, without commas or exponent notation. It is a default for each
independent run. After creating the source-backed project, create a run and
review its actual economics and costs before preparing its paper account.
Project capital is not pooled equity. Current paper accounts use reviewed fixed
spread/slippage/fees and one-times linear collateral. Historical bid/ask spreads
cannot be derived from OHLC, and an unsupported leverage selector is not offered.
See [Historical Paper Sessions](../35-paper-sessions/README.md).

The final **Review** shows what will be created. Errors retain the form. If a
save may already have completed, use **Reload Workspace** and review existing
profiles before submitting again; the app does not blindly duplicate the request.
Older empty projects remain readable, without inventing source readiness.

## Save and Verify a Read-only Setup

In the connection panel, choose **Connection provider**, enter **Connection
name**, then **Save read-only setup**. Unavailable providers show prerequisites;
saving does not make a connection healthy. Diagnostic sources are explicitly
simulated and do not certify a real platform. **Reload connections** retrieves
the current owned records.

Select the saved row and choose **Verify account**. Review the observed masked
account, server, demo/live environment, currency, checked-at time and capability
scope. An account change or stale observation requires verification again.
Rechecking cannot silently move the saved connection to another terminal login.
Follow the displayed recovery or retry time for an unavailable/rate-limited read.

The tested MT5 path attaches to the selected running Windows terminal using its
existing login, without entering a password here. Its optional SDK and local
operator prerequisites must be satisfied. It closes the Python attachment after
the read and leaves the terminal running. Measured identity and bounded raw deal
access do not establish UTC market-clock alignment or complete position
accounting. The app retains that limitation instead of guessing an offset.

Kraken's current public reachability prototype does not verify a private crypto
account. Brokerage account/authentication prerequisites remain unavailable until
an authorized provider integration is supplied. Read the displayed provider
reason and [measured adapter scope](../../plans/chartly-professional-platform/p07/adapters/README.md)
before relying on a capability. No read-only setup arms the broker dock, copying,
Workflows, a bot or order dispatch.

## Link the Correct Account and Book

Choose the destination profile and either a matching existing account or
**Create an account from observed identity**. Review account/environment/currency,
check the acknowledgement and choose **Link verified account**. Conflicting or
ambiguous matches require an explicit choice. New observed accounts start with
legacy trading disabled.

One connected book belongs to one account. Additional sources for that same
account reuse its book; another account and manual entries keep separate books.
Existing book IDs, notes and reviews remain intact. Use the linked journal action
to return to that account's facts. A paused link offers **Reconnect verified
account** only after the same identity has been reviewed again.

## Read and Review History

Choose **History from (UTC)** and **History to (UTC, exclusive)**, at most seven
days apart, then choose **Read history window**. **Use saved history checkpoint**
loads a proposed bounded continuation/overlap without starting the read. Its
exact UTC times are retained. A native continuation keeps the same original
request window, even if the last page covered a smaller subwindow.

**Review saved observations** separates retained raw events, confirmed journal
facts, actual coverage and conflicts. Receipt-only rows say **Received … ·
provider event time unverified**, keeping receipt UTC distinct from an unverified
provider timestamp. Missing pages never delete cached facts.
Repeated reads deduplicate native events; provider corrections preserve earlier
observations. Only supported, explicitly confirmed closed-trade facts can enter
the linked journal. Transfers, partial fills, unknown submissions and raw MT5
deals remain distinct observations; they are not invented closed trades.

When coverage is verified, the suggested next window includes a bounded overlap.
An unverified provider clock leaves UTC coverage/high-water unknown, including
after a native cursor finishes. Readiness is not inferred from a successful but
limited page. No background scanner starts automatically in this workflow.

For changed confirmed facts, review the retained financial-change preview and
its exact account/fields. **Apply reviewed corrections** commits those reviewed
changes while preserving notes, images and reviews. **Keep current facts**
leaves the accepted journal unchanged. Ordinary sync does not silently apply the
financial correction.

## Capability Evidence, Credentials and Recovery

**Check read-only capabilities** runs trusted checks for the observed provider,
adapter version and environment. The result shows checked-at time, measured
scope and unavailable reasons. Synthetic evidence stays labelled. Stale,
expired/revoked, reconfigured or restored records require another observation;
a typed label cannot set health or certification.

Supported credential material stays in the local encrypted vault. Read/export
operations return opaque metadata, and workspace backup excludes usable
credentials. **Revoke credential**, **Disconnect** and **Archive connection**
retain observed history; revocation/archive remove active credential/link
authority. Replacing or losing the installation key requires supported
credential setup again rather than an insecure fallback.

Complete workspace restore and Undo preserve connector observations, receipts
and provenance. They clear usable credentials and active linkage, including
same-owner restore. Verify and explicitly relink the intended account before
reading again. Cross-owner restore deliberately rebinds local references without
changing the original owner's records. Restore never starts a terminal, polling
or trading. Manual entries and statement imports remain available through the
[Trading Journal](../33-trading-journal/README.md).

The [local connector API](../../api/local-connectors.md) documents exact request,
record and page limits. [Provider plans](../../plans/chartly-professional-platform/p07/adapters/README.md)
record measured prerequisites and maintenance triggers. The separate [cost and
leverage extension proposal](../../plans/chartly-professional-platform/p07/REPLAY_COST_AND_LEVERAGE_EXTENSION.md)
describes work needed before additional simulation controls could be supported.
