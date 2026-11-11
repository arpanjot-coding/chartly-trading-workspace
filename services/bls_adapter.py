"""U.S. Bureau of Labor Statistics public API adapter (P15-T02).

Official source, no key required for the limited public tier (v2
unregistered: latest/10-year windows). Values stay exact text. BLS
period codes: M01-M12 monthly, M13 annual average (mapped to a
distinct annual series suffix, never mixed into the monthly line),
Q01-Q04 quarterly. Each fetch stamps one vintage (`retrievedAt`) for
the whole response so revisions are preserved across fetches.
"""

from __future__ import annotations

import gzip
import json
import urllib.error
import urllib.request

BLS_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data"
MAX_BYTES = 4 * 1024 * 1024
USER_AGENT = "Chartly macro research (contact: local user)"


class BlsError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def default_transport(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(MAX_BYTES + 1)
            if response.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise BlsError("bls.unreachable") from None


def _period(row):
    code = row["period"]
    year = row["year"]
    if code == "M13":
        return year, "annual"  # annual average: separate frequency
    if code.startswith("M"):
        return f"{year}-{code[1:]}", "monthly"
    if code.startswith("Q"):
        return f"{year}-Q{code[1:]}", "quarterly"
    raise BlsError("bls.period_unsupported")


def map_series(payload, *, retrieved_at):
    """Map one BLS response into immutable observations + skip counts."""
    if not isinstance(payload, dict) or payload.get("status") != "REQUEST_SUCCEEDED":
        raise BlsError("bls.request_failed")
    observations, skipped = [], 0
    for series in payload["Results"]["series"]:
        series_id = series["seriesID"]
        for row in series["data"]:
            value = row.get("value")
            if value in (None, "-", ""):
                skipped += 1
                continue
            period, frequency = _period(row)
            observations.append(
                {
                    "seriesId": series_id if frequency == "monthly" else f"{series_id}:{frequency}",
                    "period": period,
                    "frequency": frequency,
                    "value": value,
                    "retrievedAt": retrieved_at,
                    "source": "U.S. Bureau of Labor Statistics (public API v2)",
                    "sourceUrl": f"{BLS_BASE}/{series_id}",
                }
            )
    return {"observations": observations, "skipped": skipped}


def fetch_series(series_id, *, retrieved_at, transport=None, start_year=None, end_year=None):
    transport = transport or default_transport
    url = f"{BLS_BASE}/{series_id}"
    params = []
    if start_year:
        params.append(f"startyear={start_year}")
    if end_year:
        params.append(f"endyear={end_year}")
    if params:
        url += "?" + "&".join(params)
    status, body = transport(url)
    if status != 200:
        raise BlsError(f"bls.http_{status}")
    if len(body) > MAX_BYTES:
        raise BlsError("bls.response_budget")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise BlsError("bls.invalid_response") from None
    return map_series(payload, retrieved_at=retrieved_at)
