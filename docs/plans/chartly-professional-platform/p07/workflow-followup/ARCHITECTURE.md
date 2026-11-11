# Connections and local-data architecture update

3 November 2026. This repository contains the maintained follow-up diagram because the separate `chartly-docs` checkout is unavailable and the user authorized in-repository architecture documentation.

[Rendered diagram](evidence/architecture.png) · [HTML source](architecture.html).

The initial [P07 architecture](../ARCHITECTURE.md) remains historical evidence. This diagram adds personal-PC bootstrap, verified app-account tool access, reviewed browser-profile migration and actual Kraken market-history ingestion. The existing scoped connector registry, encrypted vault, bounded workers, account/book ownership, immutable data versions and chart return paths remain controlling.

The app-account decorator is used only for API key management, profile metadata and Playground catalog/key reads. It resolves the verified UID to the real internal username per request, checks an optional captured principal, and sets request-local context. It does not set global logged-in/broker flags. Trading surfaces retain their existing authority checks. Personal metadata is sanitized; named local access does not grant installation-wide SMTP visibility.

`LocalPersonalOwner` stores one stable installation UID and its credential baseline. Its random internal User row is nonadministrative and does not reuse existing named records. Personal session proofs share the existing expiry/revocation table with a distinct credential fingerprint. Proofs remain bound to loopback requests and lock on credential/MFA/role changes. Named account proof behavior is preserved.

The Kraken service has a fixed public API origin and bounded transport/decoding. It excludes the unfinished candle, preserves exact decimal strings and stages ordinary Data Library source bytes with trusted coverage/provenance. Explicit UTC 24-hour sessions support structural gap checks. No private account, credential custody or order interface is introduced by that source.
