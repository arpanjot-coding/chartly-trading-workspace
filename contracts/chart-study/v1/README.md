# Chart study process protocol v1

A chart study takes a bounded batch of UTC candles and returns numeric chart series. The protocol works over standard input and standard output. The [Python](../../../examples/python/chart_study.py) and [Node.js](../../../examples/nodejs/chart_study.mjs) examples implement `sma.close` with no external dependencies. Use the [JSON Schema](protocol.schema.json) for message shapes and the rules below for framing and time alignment.

## Run the reference study

Run these commands from the repository root in PowerShell.

```powershell
Get-Content contracts/chart-study/v1/fixtures/requests.jsonl | python examples/python/chart_study.py
Get-Content contracts/chart-study/v1/fixtures/requests.jsonl | node examples/nodejs/chart_study.mjs
```

Both commands produce the [fixture responses](fixtures/responses.jsonl). For a regression check, run `python -m pytest test/test_chart_study_protocol.py`. The cross-language tests require Node.js on `PATH`.

## Message rules

- Send one UTF-8 JSON object per line, without a byte order mark. The line limit is 1,048,576 bytes excluding LF or CRLF. The reader can also process a final nonempty line at EOF. An oversized line is drained before the next request is read.
- Send `version: 1`, a request `id`, `method: "study.evaluate"`, the `study` identifier, its `parameters`, and `candles`. IDs start with an ASCII letter and contain at most 64 letters, digits, dots, underscores or hyphens. Use distinct request IDs within a stream. Study parameters can contain up to 16 named numeric or boolean values.
- Supply 1 to 4,096 candles ordered by strictly increasing open time. `time` is an integer Unix timestamp in UTC seconds. The batch can have gaps. `open`, `high`, `low`, `close` and `volume` are finite JSON numbers represented as binary64 values. Prices have an absolute limit of 1 trillion. Volume is between zero and 1 trillion. Each candle must satisfy `low ≤ min(open, close) ≤ max(open, close) ≤ high`.
- A success echoes the request `id` and returns 1 to 8 series with distinct series IDs. Every series contains exactly one point for each input time, in the original order. Use `null` for warmup or missing values. A consumer must validate the shape, request ID and exact input-to-output alignment before plotting a result.
- The reference `sma.close` takes one integer `period` from 1 to 4,096. It uses the current candle and the preceding `period - 1` candles. The first `period - 1` points are `null`.
- A failure returns an `error.code` from the schema and echoes the ID when it could be recovered. An unreadable or oversized line has `id: null`. Diagnostic strings and request payloads are omitted from the response. Put application logs on stderr so the stdout stream stays parseable.

## Integration boundary

The reference programs run only when a developer invokes them. They read candles from stdin and write series or errors to stdout. The message schema carries no broker identity, credentials, order commands, network requests or executable source. The reference programs inherit the permissions of the shell that invokes them.

Chartly integration still requires a study registry with pinned revisions, an isolated worker with explicit CPU, memory, time, process, filesystem and network limits, and host-side validation of its responses. The chart must keep rendering when a worker fails or returns stale output for a prior instrument. The contract grants no trading or automation capability. The existing [custom JavaScript indicator loader](../../../docs/custom-indicators.md) has its own execution and trust model.
