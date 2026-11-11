# P00 historical prototype validation evidence

Status: SUPERSEDED. The earlier completion decision is withdrawn. These checks remain true only for the v1 screen harness and do not accept the revised product workflows. See [foundation revision 2](FOUNDATION_REVIEW_V2.md).

Date: 2 November 2026. Owner/reviewer: Codex. Scope: specification and isolated, fictional-data prototype. No production app code, records, credentials, broker actions or migrations changed. No external participant usability study was performed.

## Delivered evidence

- [Product specification](PRODUCT_SPECIFICATION.md): six job stories with entry/success/recovery; target routes and scope; first-run readiness; 19 screen structures; normal plus exceptional states; keyboard/narrow-layout rules; vocabulary; R1–R4 support and evidence gates.
- [Interactive prototype](index.html): 19 selectable wireframes with ready, empty, loading, saved, failed, stale, partial and unauthorized inspection. Fictional in-memory transitions only; no real import, financial calculation, persistence or connection.
- [Screen contract](screen-spec.json) and its matching browser module: routes, context, actions, state descriptions and focus expectations.
- [Workflow model](workflow.mjs) and [automated checks](workflow.test.mjs).

## Automated verification

Command from project root:

```powershell
node --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs
```

Result: 20 tests passed, 0 failed. Covers required state/route completeness, declared action resolution, journal entry independence, malformed import blocking/correction/idempotent fixture receipt, cancellation, missing data, return-to-run context, historical validation, run lifecycle/checkpoint fixtures, unknown-outcome reconciliation, distinct connection families, research outage recovery, preference-versus-permission separation, draft scope and basic markup/focus affordances.

These tests exercise the prototype model and document contracts. They do not establish production database idempotency, broker safety, matching accuracy, network security or actual restart recovery. Tests for those remain explicitly required in P02–P19.

## Browser walkthrough

Used the served prototype at `/plans/chartly-professional-platform/p00/index.html` through the in-app browser. Checked rendered headings, status, scope, action availability and focus via visible DOM/accessibility state.

- **J01 passed:** Journal → fixture trade → type review → Save review → close. Save retained its button focus after the correction below; no feed or account was required.
- **J02 passed:** Import statement → validation identified row 3 → commit unavailable → correct mapping → commit receipt → direct Review imported trades action → journal. Counts updated from two-valid/one-malformed to three-valid/zero-malformed. Model check also covers repeat commit without duplicate fixture effects.
- **J03 passed:** Start practice → Start unavailable without data → Choose run data → historical import → validate → commit dataset → Return to run R1 → Start paper run → advance → checkpoint → finish/review. Run identity/return context remained R1. Checkpoint is in-memory prototype state, not production restart proof.
- **J04 passed:** Connections → crypto setup → read-only fixture verification. Connection family displayed explicitly; no secret fields or real adapter call exists.
- **J05 passed:** Retail and brokerage setup retain their family labels. Demo activity shows unknown submission and exposes reconciliation, with no Retry/Submit order action. Reconciled fixture says acknowledged, not filled.
- **J06 passed:** Fresh fixture session → Research → example issuer → report → unavailable source → saved report snapshot marked stale → cited notebook → save, without trading setup.

All 19 screens × eight states were inspected through the browser controls: 152 rendered combinations with expected screen heading and nonempty status. This checks rendering/navigation consistency rather than the actual condition that would cause each state in production.

At 360 × 800 and 1280 × 800, all 19 prototype screens had no horizontal page overflow. A narrow import screen and desktop Workspace were visually inspected. Temporary viewport overrides were reset. Keyboard Tab from trade heading reached its labelled textarea. This is a focused keyboard/layout check, not a full screen-reader or accessibility certification.

## Findings corrected before acceptance

1. Import receipt had only Cancel instead of a next review action. Added Review imported trades and retested the handoff.
2. Corrected import rows retained the malformed count. Made fixture count/commit text reflect validation and retested.
3. Normal navigation showed empty copy despite available prerequisites. Added an explicit ready state and rechecked all eight state contracts.
4. Closed trade continued to display open-state copy. Corrected the detail/ledger fixture labels and disabled repeat close.
5. Connection setup did not display its selected family. Added crypto/retail/broker context and verified each.
6. Save rerender moved focus unnecessarily. Retained same-screen action focus while errors focus the status and navigation focuses the heading; browser Save review check passed.
7. The home Research action duplicated the navigation button label in exact-match automation. Renamed the entry CTA Research markets and reran the research-only path.

## Task acceptance trace

- P00-T01: J01–J06 in specification; six walkthrough results above.
- P00-T02: proposed routes, compatibility aliases, scope, pinning and internal return policy in specification; run return browser check.
- P00-T03: job-specific prerequisites, valid no-account/no-feed setup and downstream broker-checklist migration instruction. This is specified, not yet changed in production.
- P00-T04: S01–S19 structures plus interactive wireframes; 19-screen browser and layout inspection.
- P00-T05: screen/state contract and exception/focus/narrow policy; 152 state inspections and focused keyboard/layout evidence.
- P00-T06: explicit vocabulary, authority and unknown-versus-filled semantics; activity walkthrough.
- P00-T07: bounded R1–R4 scope and evidence. Actual first external provider/asset coverage remains a P07/P13 access/coverage decision; no adapter certification is claimed.
- P00-T08: internal task-based prototype walkthrough, findings corrected and affected paths retested.

## Completion decision

Historical decision, now withdrawn: P00 was recorded complete **as a design/specification package**. Its eight tasks and design acceptance criteria can be checked. The production implementation and live release gates remain unchecked in P01–P19. External user feedback may refine the baseline; it is not being represented as already collected.

Next: expand P01 into precise versioned contracts and valid/invalid fixtures before connecting the existing modules or moving user data. Preserve the source audit and this specification as the design baseline.
