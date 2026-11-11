# P03 completion gate contract

This describes forthcoming acceptance evidence. It does not approve the package or change a checkbox. Root owns final original-browser verification, integrated regressions and the eventual `P03_ACCEPTANCE.json`.

`tmp/validate_professional_plan.py` permits the root P03 plan/master checks only when that gate declares `packageComplete:true`. A completed gate must identify package P03, record exactly P03-T01 through P03-T08 as done with existing evidence paths, set `browserJourneysVerified:true` and `independentReviewComplete:true`, and contain nonempty `artifactHashes`. Hash keys/evidence paths are relative to this P03 directory and must resolve inside the workspace. Each hash is the current SHA-256 of a real file. Final test logs, screenshots, supported-scope limitations and implementation source should be included before capture; capture hashes after writers stop changing accepted files.

P02 remains a historical acceptance record. P03 legitimately modifies some implementation sources it originally hashed. Do not rewrite the earlier hashes or its archived logs, diagrams, fixtures and screenshots to make them describe today's code. Instead, the completed P03 gate may explicitly attest compatibility with:

```json
{
  "p02Compatibility": {
    "verified": true,
    "evidence": [
      {
        "path": "evidence/p02-regression.log",
        "sha256": "<SHA-256 of the actual final regression log>"
      }
    ]
  }
}
```

Every compatibility evidence path must be a real file under P03 `evidence`, with its current digest. For each changed P02 implementation/test source, top-level P03 `artifactHashes` must also contain the same resolved source path and its current digest. Only implementation/test roots (`frontend`, `services`, `database`, `blueprints`, `utils`, `test`, `tests`, or root `app.py`) can be superseded this way. Changed/missing P02 historical documentation/evidence remains an error. Missing compatibility proof, an unfinished P03 gate or a missing/currently wrong source hash leaves the old P02 mismatch visible.

The validator checks task/evidence consistency, source hashes, browser/review flags, all package checkboxes and local plan links. It does not infer that tests passed from an arbitrary file's existence; the recorded verification must be the actual reviewed result. `tmp/test_p03_plan_gate.py` exercises seven forward-gate cases with mocked in-memory acceptance data and a virtual log. It never writes an acceptance gate or checks off real work.
