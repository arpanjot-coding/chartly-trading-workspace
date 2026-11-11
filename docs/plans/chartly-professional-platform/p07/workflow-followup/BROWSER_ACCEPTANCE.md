# Original-screen workflow acceptance

3 November 2026. Root accepted these original-screen journeys against the compiled app. Browser QA uses actual React and Flask services at ports 5018/5019 with separate synthetic user/workspace databases. The installed app remains port 5000. No installed profile migration or user trade mutation was performed during QA.

## Journeys checked

- Personal entry opened Workspace with the saved fixture environments and no password/broker prompt. The profile and journal names were synthetic.
- New profile → Live channel → optional details → Review showed Next: Connections, with no simulator/later radio branch. Create opened `/workspace/profiles/4/connections`.
- Desktop platforms → MetaTrader 5 → named setup → Verify account attached to the authorized already running terminal. The UI showed ready/healthy and masked account identity, actual demo environment and GBP currency. Account linking and history/execution actions were not submitted. [Screenshot](evidence/mt5-visible-verified.jpg).
- The profile-scoped hub retained its selected profile and Chart/Journal/Open links. Crypto and brokerage choices show provider-specific planned/prerequisite status. No default Zerodha detour is used. [Hub](evidence/connection-hub.jpg).
- Kraken → History & data → public instrument search → XBT/USD → Fetch closed candles → quality review returned 720 closed candles. After correcting the source calendar, rejected/outside-session/unclassified/off-grid/missing/warning counts were all zero. The unfinished candle was excluded. [Corrected review](evidence/kraken-preview-reviewed.jpg). The initial false-warning view remains separately archived as evidence of the finding, not an accepted result.
- Publish immutable version → Review saved version displayed fixed coverage and source receipt. Open chart rendered the existing chart controls and 720 actual bars, with read-only account orders. Reload preserved the same version and prices; Back to Data Library returned to its exact version, then Return to connections restored profile 4. [Existing chart](evidence/kraken-existing-chart.jpg).
- Connections → Journal opened its separate manual book with existing Overview/Trades/Calendar/Breakdown tabs. Open chart retained the journal-return context; Back to the same journal restored the original profile/book. No recorded trade was edited.

## Final integration and restart checks

- A separate empty fixture created a browser-only live profile, with MT5 visible before durable setup. Use existing profiles → Preview existing profiles showed the actual two-profile source → Save these profiles activated local storage. After the session interruption and fixture restart, the same owned workspace and profile were restored. Back to Connections opened the correct profile without a password prompt. [Reviewed local migration](evidence/reviewed-profile-migration.jpg).
- Settings → Developer API opened without a broker login. No key was generated or approval policy changed. Broker metadata remained Unknown when the fixture could not supply it. [API page](evidence/developer-api-local.jpg).
- Open Playground displayed REST/WS catalog and request workspace, without Live/Analyze controls. No Send action was submitted. [Playground](evidence/playground-no-global-mode.jpg).
- Settings → Account & preferences displayed Personal PC / Local workspace, without internal username, password/SMTP/authenticator controls. Theme buttons were enabled independently of trading mode; no preference was changed. [Appearance](evidence/preferences-theme-unlocked.jpg).
- The installed app was resumed after its process stopped during the interruption. Read-only HTTP checks passed for its five affected page routes, 36-entry public provider catalog, and anonymous-private-data refusals. [Actual smoke output](evidence/main-app-smoke.log). Desktop platforms → MetaTrader 5 is visible there before profile migration. [Main-app entry](evidence/main-app-mt5-entry.jpg).

The final frontend build includes only whitespace cleanup after the passing full source run. The actual source/calendar, app-account guards and provider copy were included in the frozen behavioral tests. Native MT5 timing/canonical accounting and other private providers remain explicitly unverified; neither these screenshots nor a public price chart certify execution.
