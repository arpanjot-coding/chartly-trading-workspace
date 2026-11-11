# P04 market-history normalization and quality policy

Implemented 3 November 2026 in `services/dataset_quality.py`. This is a pure, bounded parser and analyzer. It performs no database/file/network I/O, executes no supplied expressions and retains no upload-specific module state. The original Historify database/parser remains a separate legacy path; its implicit time/unit/zero-fill behavior does not establish a checked version.

## Public boundary

`normalize_history(csv_text, mapping, context, previous_bars=())` returns a `chartly-history-preview`, version 1. `validate_mapping`, `validate_context`, `validate_calendar` and `analyze_bars(bars, context)` are also exported. Invalid envelopes/metadata raise `DatasetQualityError`, with `code`, `status` and a plain-language message. Invalid source rows are reported individually. Conflicting candles at one timestamp inside the same file always block commit. Other rejected rows may coexist with valid data, but the service must require explicit consent before excluding them from a committed version.

Mapping version 1 declares exact CSV column names for timestamp and every OHLC field, with optional volume and openInterest. It declares timestamp format (`iso`, `seconds` or `milliseconds`), an IANA source timezone, candle-opening meaning, delimiter and number separators. Closing-label conversion is explicitly unsupported; the parser never guesses a daily close/session shift. Allowed delimiters are comma, semicolon, tab and pipe. Decimal separators are point/comma; grouping separators may be point/comma/space/apostrophe and must differ from the decimal separator. Grouped numbers require groups of three digits. Header matching is explicit and case-sensitive; header names themselves cannot be blank or duplicate ignoring case. Credential headers are refused.

Dataset context declares provider, symbol, exchange, native interval, price basis, adjustment/roll description, volume meaning, negative-price permission and a calendar snapshot. Optional fields are display name, instrument/source IDs and native currency/asset code. Provider names normalize to lowercase; symbols/exchanges retain their declared case. The caller resolves private owner/source identity; a CSV cannot name an owner. Display names are not economic identity. No price adjustment or continuous-contract roll is inferred/applied from the description.

## Native candles and exact values

Native intervals are `1s`, `5s`, `15s`, `30s`, `1m`, `2m`, `3m`, `5m`, `10m`, `15m`, `30m`, `1h`, `2h`, `4h` and `D`. `1D` normalizes to `D`. This boundary does not advertise a derived timeframe as stored native history. Uppercase monthly tokens and arbitrary multiples are not silently treated as minute data.

A canonical bar contains exactly `time`, `timestamp`, `open`, `high`, `low`, `close`, `volume` and `openInterest`. Prices and known volume/OI are normalized plain base-10 strings, with at most 40 integer and 24 fractional digits. Trailing zeros and negative zero normalize without Decimal context rounding; source lexical values remain in retained raw rows/CSV. `NaN`, infinity and exponent notation are rejected. All four prices are required and must satisfy:

`low <= min(open, close) <= max(open, close) <= high`.

Zero prices are allowed. Negative prices require explicit instrument permission. Volume/OI must be nonnegative; absent/unmapped/blank values remain null and never become zero. Fractional quantity volume is retained. Tick-count volume requires an integer count. Volume meaning may be unknown, units, contracts, ticks or currency; an unknown unit is disclosed rather than guessed.

## UTC conversion and precision

`time` is the authoritative opening instant in UTC ISO form with six fractional digits and `Z`. `timestamp` is a chart-compatible numeric epoch-seconds projection. The caller stores integer microseconds or the authoritative ISO value when exact time identity is required; it must not reconstruct canonical time through floating-point rounding.

Epoch seconds/milliseconds are explicit mapping choices, with no magnitude heuristic. Pre-epoch dates are supported without calling host-local `timestamp()`/`fromtimestamp()`. Fractional values are retained to a microsecond; nonzero finer precision is rejected. Extra fractional zeros do not lose information. ISO values with offsets normalize to UTC. Naive ISO dates/times use the declared IANA zone, checked by round-tripping both folds: nonexistent spring times and ambiguous fall times require user resolution through an actual offset. Date-only ISO values mean declared-zone midnight; no exchange date or market-open time is invented.

`analyze_bars` validates a merged or restored canonical set atomically. It requires every canonical field, exact string/null economics, normalized UTC time and finite numeric timestamp agreeing within one microsecond. Invalid OHLC/time/projection or conflicting duplicate timestamps rejects the whole set. This function recomputes content/coverage/quality after a caller applies keep/replace/new-snapshot policy; an uploaded fragment's quality must not be misrepresented as the merged version's quality.

## Duplicates, order and overlap

Canonical bars are chronological. Nonchronological source rows are reported as reordered. Identical duplicate timestamps count once, while different values at one timestamp inside the file produce a conflict. Against the caller's same-source previous bars, unique rows are accepted, unchanged or changed; the normalizer does not choose a merge policy or overwrite an immutable version.

`sourceHash` is SHA-256 of the original UTF-8 CSV bytes, including line endings/BOM. `contentHash` is SHA-256 of sorted canonical candle facts (UTC time and exact normalized economics), excluding the approximate numeric time projection. Reordering or lexical zero changes can alter source hash without altering numerical content hash. Source/instrument/calendar/basis/permission identity is resolved by the enclosing Dataset service and remains distinct from the candle-content checksum.

## Declared calendars and gap classification

The default is `{id:'unknown', timezone:'UTC', sessions:[], exceptions:{}}`. It does not mean a continuous market. Declared calendars contain a stable ID, IANA exchange/session timezone, weekly sessions and date exceptions. Weekdays are Monday 0 through Sunday 6. Sessions contain open/close `HH:MM`; `24:00` is permitted only as a close. Continuous trading is explicitly `00:00`–`24:00` on all seven days. A close earlier than the open is an overnight window anchored on the opening date. Equal endpoints are rejected rather than guessing empty/full-day meaning.

An exception such as `{'2026-12-25':[]}` replaces sessions anchored on that date. An overnight window started on the previous date is still the previous date's session; close that prior anchor explicitly when intended. Overlapping weekly/exception/overnight windows are rejected. Session boundaries use actual zone offsets on each source date, with no fixed IST or host timezone arithmetic. Ambiguous calendar boundaries remain unclassified rather than selecting a fold silently.

For intraday data, expected opening slots follow each declared session's open and native interval. The analyzer counts slots arithmetically within each session; it never loops over every absent second. Daily history counts intervening declared open dates, so a 23/25-hour DST day is not automatically a missing daily bar. More than one distinct daily opening on the same declared local date is preserved with a warning and cannot claim verified structural completeness. Dates without sessions are market closures, not corruption. Candle values/times outside the declared session or off its interval grid remain preserved with explicit warnings.

Gaps classify as missing_expected, market_closed or unclassified. Unknown-calendar gaps and gaps exceeding the bounded calendar scan remain unclassified; missingExpectedBars is null when an unclassified gap or unknown calendar prevents a complete claim. knownMissingExpectedBars retains a lower-bound count from classified windows. No gap is filled and no adjacent price jump is automatically called a roll/error.

## Reports, quality and bounds

The result includes full canonical bars, row action/error/warning details, counters, coverage segments and quality. Counters distinguish accepted/rejected/duplicate/unchanged/changed/conflicts/reordered/outsideSession/offGrid/calendarUnclassified/duplicateDailyDates/gaps/missingExpectedBars. Missing volume and OI have independent coverage counts. Quality status is invalid when no valid candles or an intra-file conflict prevents commit, partial when rejected rows/session/grid/gap/calendar uncertainty remains, otherwise verified. Its declared scope is always structural_checks_only: verified never certifies provider authenticity, completeness outside the supplied range, adjustment truth or market licensing.

Limits are 8 MiB UTF-8 CSV, 50,000 nonblank source rows, 32 columns, 2000 characters per cell and 100,000 previous comparison bars. A canonical merged/restored version is capped at 50,000 candles. A calendar has at most 16 weekly windows and 1000 exceptions, with at most eight windows per exception. Calendar gap scanning has a total 36,600-day budget per analysis; larger ranges return an explicit unknown classification.

Row details, segment details and gap details are each capped at 1000, with total counts and truncation flags retained. Late rejected rows replace earlier successful details so errors remain visible. `quality.rowErrors` aggregates every rejection code/count and its first ten row numbers even if detailed samples are capped. Canonical data and total counters are never truncated by display limits. The caller retains/export the original CSV and full canonical version independently.

## Verification

`test/test_dataset_quality.py` covers exact/unknown economics, every native interval, unit/timezone conversion, pre-epoch microseconds, DST gaps/folds, negative/zero prices, malformed OHLC/numbers, duplicates/conflicts/overlap, holidays/weekends/breaks/overnights, daily DST boundaries, calendar ambiguity/scan limits, report truncation, canonical restoration checks and roll metadata without guessed adjustment. The three files in `test/fixtures/p04` describe a documented New York session with one missing minute and unknown volume on one candle.

Focused command: `.venv/Scripts/python.exe -m pytest test/test_dataset_quality.py -q --disable-warnings`. The final focused run passed 81 cases, including bounded late-error reporting and malformed/overlapping calendars. Targeted Ruff check/format also passed. Root owns the integrated P04 transport, storage, chart/UI and package acceptance evidence.
