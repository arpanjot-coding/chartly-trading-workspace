# Published chart dependency

The frontend now pins published `chartly-charts` 2.4.5 from the npm registry.
`package-lock.json` records the registry archive URL and its SHA-512 integrity.
The installed package was checked against all 33 files in that archive.

Any local `openalgo-charts-2.4.0-*.tgz` archives are previous development
candidates and stay outside version control. The package manifest and lockfile
do not reference them.
Do not replace the published pin with an absolute worktree path.

This release includes portable workspace/template storage, OI studies and
alerts, coordinated replay, comparisons, CSV export and optional instrument,
localization and trading capability contracts. Package availability does not
mean every control has been integrated into `/trading`; the terminal guide
describes the host behavior that is currently wired.
