# Independent correctness and ownership review

3 November 2026. The developer-tools specialist reviewed the personal-access boundary and wrote **34 actual Flask/API review tests** independently of the implementation. The provider specialist separately read the personal proof, request restrictions and owner rebinding. Root inspected the integrated screens and resolved findings before acceptance. A final independent UI verification passed **2,495 tests / 230 suites**, types, 50-file Biome and the production build.

The API review covers loopback/Host/Origin/proxy restrictions, copied cookies, missing or mismatched expected principal, revoked/expired/future proofs, credential/MFA changes, personal-owner administrator promotion, existing named-account preservation, pending MFA, native operator scope and sanitized local account metadata. These are actual cookie/CSRF/SQL tests, not a stubbed claim that authentication succeeded.

Findings resolved:

1. Legacy API key POST/mode routes accepted a client-supplied username. They now use the authenticated session owner and reject a mismatch; frontend requests omit the selector and carry the captured principal.
2. Personal profile metadata exposed generated TOTP/internal-account details. Its dedicated response now reports only Local workspace and empty account-security metadata. Named-account details also clear on owner changes in the UI.
3. Promoting the installation owner to administrator could leave personal bootstrap active. The proof and bootstrap now lock on that role change, as they do for MFA or password changes.
4. Saved-workspace requests needed a central captured-principal header and a post-JSON owner check. Both now guard ordinary storage reads and writes, with an actual delayed-response regression.
5. Browser review found a false calendar warning for every Kraken candle. Explicit 24/7 UTC sessions fix the trusted source context; tests cover a complete 720-row Tuesday window and a genuine missing bar.
6. Browser review found that the Developer API navigation still required a global broker login. Narrow verified-account route layouts repair those three destinations while preserving broker-only trading guards. The actual App route regression passed 25 tests across three suites; personal-mode API key, Playground and preferences entry passed the final browser review. The backend account-only decorator also accepts genuine named local proofs, resolves their actual owner and preserves legacy trading guards; review tests use no forged legacy login flags.

The final 34-case API review and 25-case route selection overlap the full regression totals. [Backend review output](evidence/account-access-review.log), [route proof](evidence/account-route-tests.log), [full frontend result](evidence/frontend-regression.log). No financial API request or order was submitted during the browser review.

The source review does not certify unimplemented providers or full MT5 accounting. Remaining provider access, clock, product/permission and execution requirements are documented in the [delivery roadmap](../../provider-connectivity/README.md).
