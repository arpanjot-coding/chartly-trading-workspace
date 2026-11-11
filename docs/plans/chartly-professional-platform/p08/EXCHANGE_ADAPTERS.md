# P08 repeat-per-exchange — adapter registry (Path A cloud APIs)

Added 4 November 2026 per the BYOB platform spec. Every adapter
follows the Kraken two-phase pattern: Phase A fixture-verified
(signing, identity, history mapping, instruments) + live **public**
data verification; Phase B certifies private reads with the user's
own keys. Order dispatch does not exist in any of them (P11 owns
writes). Numbers stay exact text end-to-end.

| Provider id | Module | Auth | Withdrawal safety | Demo/testnet | Live public check |
| --- | --- | --- | --- | --- | --- |
| `kraken` | connector_kraken.py | HMAC-SHA512 | query-only keys required by policy | none (read-only keys) | AssetPairs 1,276 mapped |
| `binance` | connector_binance.py | HMAC-SHA256 query | **refused if `enableWithdrawals`** (apiRestrictions) | spot testnet | BTCUSDT tick 0.01, minNotional 5 |
| `bybit` | connector_bybit.py | HMAC v5 headers | **refused if Withdraw permission** | testnet | BTCUSDT step from basePrecision 0.000001 |
| `coinbase` | connector_coinbase.py | CDP JWT ES256 (uri-bound) | view-only CDP keys (documented) | — (sandbox deprecated) | BTC-USD online, tick 0.01 |
| `okx` | connector_okx.py | HMAC + passphrase | **refused if perm includes withdraw** | demo (`x-simulated-trading`) | BTC-USDT live, tick 0.1 |
| `bitget` | connector_bitget.py | HMAC + passphrase | **refused if authorities include withdraw** | — | BTCUSDT online, derived tick 0.01 (labelled derived) |
| `hyperliquid` | connector_hyperliquid.py | none — wallet address | **no secret accepted at all** | testnet host | BTC in meta universe, szDecimals 5 |
| `topstepx` | connector_topstepx.py | loginKey → bearer | prop simulation account (no withdrawals exist) | evaluation accounts are the demo | fixture-only (auth required even for contracts) |

Identity per venue: Binance `uid`, Bybit `userID`, OKX `uid`,
Bitget `userId`, Coinbase first account UUID, Hyperliquid the wallet
address itself, TopstepX account id — key fingerprint only where the
venue exposes no account id. Identity is re-checked on every history
call (`connector.identity_changed`).

Phase B shopping list for the user (any subset, in any order):
Kraken query-only key; Binance spot-testnet or read-only key
(withdrawals OFF); Bybit testnet/read-only key; Coinbase view-only
CDP key; OKX read-only key (+passphrase, demo ok); Bitget read-only
key (+passphrase); any Hyperliquid wallet address (no key needed);
TopstepX API key. Each lands as a short certification exactly like
the MT5 live session (P09-T08).
