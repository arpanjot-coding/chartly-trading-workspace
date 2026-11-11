"""Read-only bridge to the existing owner-bound history adapter, never implicit keys."""

import csv
from datetime import UTC, datetime, timedelta
from decimal import Decimal, localcontext
from io import StringIO
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from services.dataset_downloads import DownloadFetchError


def _owner_binding(uid, include_key=False):
    from database import auth_db, user_db

    with user_db.engine.connect() as connection:
        username = connection.execute(
            select(user_db.User.username).where(user_db.User.identity_uid == uid)
        ).scalar_one_or_none()
    if not username:
        return None
    with auth_db.engine.connect() as connection:
        auth = (
            connection.execute(select(auth_db.Auth.__table__).where(auth_db.Auth.name == username))
            .mappings()
            .first()
        )
        key = connection.execute(
            select(auth_db.ApiKeys.api_key_encrypted).where(auth_db.ApiKeys.user_id == username)
        ).scalar_one_or_none()
    if not auth or auth["is_revoked"] or not auth["broker"] or not key:
        return None
    result = {"provider": auth["broker"].lower(), "username": username}
    if include_key:
        result["key"] = auth_db.decrypt_token(key)
    return result


def capabilities(uid):
    try:
        binding = _owner_binding(uid)
    except SQLAlchemyError:
        return {
            "available": False,
            "reason": "The provider connection store is unavailable. Local CSV import and saved history remain available.",
        }
    if not binding:
        return {
            "available": False,
            "reason": "Connect a provider and configure this local account’s existing market-data API key before requesting downloads. CSV imports and saved charts work independently.",
        }
    return {
        "available": True,
        "provider": binding["provider"],
        "intervals": ["1m", "D"],
        "reason": "Uses the current local account’s configured history adapter. Provider coverage, rights and limits still apply. No orders are sent.",
    }


def fetch_owner_history(request):
    binding = _owner_binding(request["principalUid"], True)
    context = request["context"]
    mapping = request["mapping"]
    if not binding:
        raise DownloadFetchError("dataset.provider_not_connected", 403)
    if context["provider"].lower() != binding["provider"]:
        raise DownloadFetchError("dataset.provider_binding_changed", 409)
    if context["interval"] not in ("1m", "D"):
        raise DownloadFetchError("dataset.provider_interval_not_supported", 400)
    from services.history_service import get_history

    start = datetime.fromisoformat(request["startAt"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(request["endAt"].replace("Z", "+00:00"))
    success, response, status = get_history(
        symbol=context["symbol"],
        exchange=context["exchange"],
        interval=context["interval"],
        # Legacy adapters accept dates in differing exchange conventions. Fetch
        # a padded UTC window, then enforce the exact half-open UTC chunk below.
        start_date=(start - timedelta(days=1)).date().isoformat(),
        end_date=(end + timedelta(days=1)).date().isoformat(),
        api_key=binding["key"],
        background=True,
    )
    current_binding = _owner_binding(request["principalUid"], True)
    if current_binding != binding:
        raise DownloadFetchError("dataset.provider_binding_changed", 409)
    if not success:
        retry_after = (
            response.get("retryAfter", response.get("retry_after"))
            if isinstance(response, dict)
            else None
        )
        raise DownloadFetchError("dataset.provider_request_failed", status, retry_after)
    rows = response.get("data") if isinstance(response, dict) else None
    if not isinstance(rows, list) or len(rows) > 50000:
        raise DownloadFetchError("dataset.provider_invalid_response", 502)
    fields = tuple(mapping["columns"])
    stream = StringIO(newline="")
    writer = csv.writer(stream, delimiter=mapping.get("delimiter", ","))
    writer.writerow([mapping["columns"][key] for key in fields])
    count = 0
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    for row in rows:
        try:
            stamp_text = str(row["timestamp"])
            if len(stamp_text) > 100:
                raise ValueError()
            with localcontext() as precision:
                precision.prec = 120
                timestamp = Decimal(stamp_text)
                if (
                    not timestamp.is_finite()
                    or abs(timestamp) > 253402300799
                    or (timestamp * 1000000) != (timestamp * 1000000).to_integral_value()
                ):
                    raise ValueError()
                when = epoch + timedelta(microseconds=int(timestamp * 1000000))
            if not start <= when < end:
                continue
            values = []
            for field in fields:
                if field == "timestamp":
                    value = (
                        when.isoformat(timespec="microseconds").replace("+00:00", "Z")
                        if mapping["timestampFormat"] == "iso"
                        else format(
                            timestamp
                            * (1000 if mapping["timestampFormat"] == "milliseconds" else 1),
                            "f",
                        )
                    )
                else:
                    value = (
                        row.get("openInterest", row.get("oi"))
                        if field == "openInterest"
                        else row.get(field)
                    )
                    if value is not None:
                        text = str(value)
                        if len(text) > 120:
                            raise ValueError()
                        number = Decimal(text)
                        if (
                            not number.is_finite()
                            or number.adjusted() > 39
                            or number.as_tuple().exponent < -24
                        ):
                            raise ValueError()
                        value = format(number, "f").replace(
                            ".", mapping.get("decimalSeparator", ".")
                        )
                # Serialize the normalized numeric adapter value in the declared
                # CSV convention without grouping, rounding or invented volume.
                values.append("" if value is None else str(value))
            writer.writerow(values)
            count += 1
        except (KeyError, TypeError, ValueError, ArithmeticError, OverflowError) as error:
            raise DownloadFetchError("dataset.provider_invalid_response", 502) from error
    return {"csvText": stream.getvalue(), "empty": count == 0}
