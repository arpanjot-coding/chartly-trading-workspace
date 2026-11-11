# Contributing to Chartly

Read the [quick start](README.md#quick-start) to build the frontend and run the app locally. For product context, start with the [workflow review](docs/CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) and the [release checklist](docs/plans/chartly-professional-platform/CHARTLY_QUALITY_AUDIT.md).

Open an issue for a bug or feature request. Create a branch for your change and open a pull request against `main`.

- Use disposable databases and synthetic candles, profiles, and trades when reproducing a problem. Keep broker credentials, account identifiers, journal exports, and personal screenshots out of commits and issue attachments.
- Describe the workflow that changed, how to reproduce it, and what you verified. For visual changes, include screenshots from the running app.
- Run the checks that cover your change. For a frontend change, run `npm run test:run` and `npm run build` from `frontend`. For a backend change, run the relevant `uv run pytest` targets from the project root.
- Explain any limits of verification, particularly when a connector needs a provider account or a local terminal.

Follow [Security](SECURITY.md) to report a vulnerability.
