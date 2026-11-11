# P07 original-screen workflow verification

3 November 2026. Root inspected the actual built React app in the in-app browser. Financial writes used only the named disposable `localhost:5017` fixture, synthetic principals/accounts and declared synthetic history. The installed app on port 5000 received only read-only route checks. No private MT5 screenshot, credential or account activity was copied into these screen artifacts.

## Replay creation and original chart

Workspace exposes one **New profile** entry. The type choice is made once. The walkthrough selected Replay, named the project, chose both London and New York tags, kept Europe/London explicitly, left strategies optional and entered USD 2,500 default paper capital. Tags did not change the timezone.

Setup/review refused creation without an owned nonempty history version and the explicit review checkbox. Import/manage history opened Historify with a return path; returning reopened the same wizard step with name, currency, capital, tags and timezone preserved. Selecting fixture A showed 150 valid candles, source, exact interval/currency and quality limits. Creation pinned the version/checksum and set the native `EXAMPLE` / `1m` defaults. A separate run retained that pin and required its own positive capital. [Required-history review](evidence/replay-required-history.png).

The run opened the existing chart with 150 bars and the exact dataset version in the URL. Drawing toolbar, intervals, indicators, dock and paper/journal panels remained the original chart UI. No live order authority appeared. **Back to Replay runs** returned to the same project. The project reports independent runs and capital rather than fictitious pooled equity. [Original replay chart](evidence/replay-original-chart.png), [persisted fixture assertions](evidence/browser-fixture-state.json).

## Account connection, bounded sync and journal return

In original profile Connections, the synthetic diagnostic setup initially showed unverified/unknown with no account authority. **Verify account** observed its masked identity, server, environment, currency and declared synthetic scope. Linking required explicit account review, then created/reused the exact account's separate connected book. Manual books remained separate. Submit/cancel/protective-order capabilities stayed unavailable.

The first default history window contained no fixture trades; it correctly reported only that returned window. Selecting November 1–2 UTC read two confirmed synthetic trades. Repeating the same window kept two observations/facts and two journal rows, each with USD 1.70 net, rather than duplicating them. Date changes were made with native date-control keyboard input; this browser's programmatic date fill did not persist React state, so no fill-only attempt was counted as proof. [History screen](evidence/connection-history.png), [journal](evidence/connected-journal.png).

**Open connected journal** selected that book and Trades tab. **Open chart** carried a journal return URL; **Back to P07 Journal environment journal** returned to the same book and tab, still showing two rows. The chart displayed saved history without enabling broker orders. [Chart return context](evidence/journal-chart-return.png).

## Corrections, freshness and reconnect

A guarded fixture helper staged a source correction and a user review note, without applying the financial change. The actual screen showed retained fields `exitPrice: 101 → 101.5`, `grossPnl: 2 → 3`, and `netPnl: 1.7 → 2.7`. Apply required explicit review. [Exact correction review](evidence/correction-review.png).

An intentionally delayed review exceeded the 120-second freshness limit. The server rejected it, preserved existing financial facts and offered reload/recheck. This exposed a dialog visibility issue; the final component closes the dialog after either success or rejection so the result and recovery actions are visible. Focused tests cover success, expired verification and interrupted responses with same-request retry.

After rechecking the same identity, applying the retained correction produced exactly two rows, net USD 2.70 and USD 1.70, and kept the note `P07 retained user review`. No new provider fetch or order was part of apply. [Persisted financial and metadata proof](evidence/browser-fixture-state.json).

Disconnect changed state to disconnected/offline, disabled history reads and retained the book, observations and corrected facts. Verification alone left the history link paused; the explicit same-account reconnect checkbox and action restored that same account/book. No automatic catch-up or startup scanner was enabled.

The first screen pass also caught a legacy account-field mismatch: new observed records wrote `isEnabled` while the UI reads `enabled`. The implementation now creates records with `enabled: false`; existing account intent is preserved. A separate synthetic beta setup exercises the final creation path and distinct book.

The rebuilt final screen verified that beta's newly created account is **Off**, retained alpha as a separate account, and closed the correction dialog on successful apply. The returned connection screen exposed the saved notice with no pending correction. Opening beta's book then showed exactly USD 1.70 and USD 2.70, the corrected exit price, and the updated journal copy directing explicit connection reads. [New account Off](evidence/new-account-disabled.png), [completed correction](evidence/correction-completed.png), [final journal](evidence/corrected-journal-final.png). The fixture assertions also confirm both manual trades remain open and separate.

The original installed browser tab still contained an older, unsaved creation form. Root read it without refreshing or discarding the draft. This revealed a server-authority gap: the final durable API now rejects a newly created replay project or a live-to-replay transition without owned, nonempty, unarchived history. Authenticated/CSRF API regressions test rejection with no state change and acceptance of the exact owned version; stored empty replay projects, reviewed migration and restore remain compatible. An old cached wizard cannot bypass the requirement. Its safe error directs importing and reviewing history in Data Library.

## Evidence boundaries

Actual source access is recorded separately in [MT5 evidence](evidence/mt5-read-only-access.json) and [provider plans](adapters/README.md). MT5 native timestamps differed from host UTC; market timing remains unknown and raw account history is not certified as full closed-trade accounting. Synthetic journal examples certify this workflow, not real-provider accounting.

Encrypted vault, restore/Undo, cross-owner rebind, conflict/CAS and partial/unknown-event behavior have executable SQL/API tests and [independent review](INDEPENDENT_REVIEW.md). This walkthrough does not claim those restore scenarios were repeated through a browser file chooser. The architecture was rendered and visually inspected: [HTML](architecture.html), [PNG](evidence/architecture.png). [Original app read-only smoke](evidence/main-app-smoke.json).

The final backend and production frontend are served on the original port 5000. The task-created test tabs and isolated port 5017 server were closed after verification; saved fixture/evidence files were retained. The user's original tab and its unsaved form were left intact.

Current paper support remains reviewed fixed costs and 1× linear collateral. Historical spread reconstruction and leveraged margin/stop-out require the separately specified [extension](REPLAY_COST_AND_LEVERAGE_EXTENSION.md). They are not represented as implemented controls.
