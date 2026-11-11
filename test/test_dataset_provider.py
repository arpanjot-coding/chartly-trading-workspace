"""Independent owner-binding and read-only adapter conformance; no provider calls."""

import csv
from copy import deepcopy
from datetime import UTC, datetime
from io import StringIO

import pytest
from sqlalchemy import insert, update
from sqlalchemy.exc import OperationalError
from test_local_data_api import login

from database import auth_db, user_db
from database.engine_factory import create_db_engine
from services import dataset_provider, history_service
from services.dataset_downloads import DownloadFetchError
from services.dataset_quality import normalize_history

pytest_plugins = ["test_local_data_api"]
OWNER = "principal_provider_owner"
OTHER = "principal_provider_other"
START = "2026-11-01T00:00:00Z"
END = "2026-11-02T00:00:00Z"


@pytest.fixture
def bindings(tmp_path, monkeypatch):
    users = create_db_engine("sqlite:///" + (tmp_path / "provider-users.db").as_posix())
    brokers = create_db_engine("sqlite:///" + (tmp_path / "provider-auth.db").as_posix())
    user_db.Base.metadata.create_all(users)
    auth_db.Base.metadata.create_all(brokers)
    with users.begin() as connection:
        for uid, name in ((OWNER, "owner"), (OTHER, "other")):
            connection.execute(
                insert(user_db.User.__table__).values(
                    identity_uid=uid,
                    username=name,
                    email=name + "@example.test",
                    password_hash="fixture-only-hash",
                    totp_secret="fixture-only-totp",
                )
            )
    with brokers.begin() as connection:
        for name in ("owner", "other"):
            connection.execute(
                insert(auth_db.Auth.__table__).values(
                    name=name,
                    broker="FIXTURE-BROKER",
                    auth="fixture-auth-" + name,
                    is_revoked=False,
                )
            )
            connection.execute(
                insert(auth_db.ApiKeys.__table__).values(
                    user_id=name,
                    api_key_hash="fixture-hash-" + name,
                    api_key_encrypted="fixture-cipher-" + name,
                )
            )
    monkeypatch.setattr(user_db, "engine", users)
    monkeypatch.setattr(auth_db, "engine", brokers)
    decrypted = []
    monkeypatch.setattr(
        auth_db, "decrypt_token", lambda value: decrypted.append(value) or "decoded-" + value
    )
    monkeypatch.setattr(
        auth_db,
        "get_first_available_api_key",
        lambda: pytest.fail("A private dataset must never use an implicit first key"),
    )
    yield {"users": users, "brokers": brokers, "decrypted": decrypted}
    users.dispose()
    brokers.dispose()


def request(**changes):
    value = {
        "jobId": "download_fixture",
        "principalUid": OWNER,
        "context": {
            "provider": "fixture-broker",
            "symbol": "EXAMPLE",
            "exchange": "FIXTURE",
            "interval": "1m",
            "priceBasis": "raw",
            "adjustment": "none",
            "volumeMeaning": "unknown",
            "allowNegativePrices": False,
        },
        "mapping": {
            "version": 1,
            "columns": {
                key: key
                for key in ("timestamp", "open", "high", "low", "close", "volume", "openInterest")
            },
            "timestampFormat": "iso",
            "timestampMeaning": "open",
            "timezone": "UTC",
        },
        "startAt": START,
        "endAt": END,
        "attempt": 1,
    }
    value.update(changes)
    return value


def candle(when=START, **values):
    return {
        "timestamp": datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp(),
        "open": "1.2",
        "high": "1.4",
        "low": "1.1",
        "close": "1.3",
        **values,
    }


def bind_stub(monkeypatch, state=None):
    state = state or {"provider": "fixture-broker", "username": "owner", "key": "fixture-only-key"}

    def binding(uid, include_key=False):
        assert uid == OWNER
        return deepcopy(state)

    monkeypatch.setattr(dataset_provider, "_owner_binding", binding)
    return state


def test_binding_uses_exact_principal_username_key_and_never_decrypts_for_capability(bindings):
    assert dataset_provider.capabilities(OWNER)["provider"] == "fixture-broker"
    assert bindings["decrypted"] == []
    assert dataset_provider._owner_binding(OWNER, True) == {
        "provider": "fixture-broker",
        "username": "owner",
        "key": "decoded-fixture-cipher-owner",
    }
    assert dataset_provider._owner_binding(OTHER, True)["key"] == "decoded-fixture-cipher-other"
    assert dataset_provider._owner_binding("principal_missing", True) is None
    with bindings["brokers"].begin() as connection:
        connection.execute(
            update(auth_db.Auth.__table__)
            .where(auth_db.Auth.name == "owner")
            .values(is_revoked=True)
        )
    assert not dataset_provider.capabilities(OWNER)["available"]
    assert dataset_provider.capabilities(OTHER)["available"]


def test_missing_own_key_never_uses_another_local_accounts_key(bindings):
    with bindings["brokers"].begin() as connection:
        connection.execute(
            update(auth_db.ApiKeys.__table__)
            .where(auth_db.ApiKeys.user_id == "owner")
            .values(api_key_encrypted="")
        )
    assert dataset_provider._owner_binding(OWNER, True) is None
    assert dataset_provider._owner_binding(OTHER, True)["username"] == "other"
    assert bindings["decrypted"] == ["fixture-cipher-other"]


def test_fetch_reads_owner_key_and_api_source_only_with_half_open_utc_filter(bindings, monkeypatch):
    seen = []

    def fetch(**kwargs):
        seen.append(kwargs)
        return (
            True,
            {
                "data": [
                    candle("2026-10-31T23:59:59Z"),
                    candle(START),
                    candle("2026-11-01T23:59:59Z"),
                    candle(END),
                ]
            },
            200,
        )

    monkeypatch.setattr(history_service, "get_history", fetch)
    response = dataset_provider.fetch_owner_history(request())
    assert seen[0]["api_key"] == "decoded-fixture-cipher-owner"
    assert seen[0].get("source", "api") == "api" and seen[0]["background"] is True
    assert seen[0]["symbol"] == "EXAMPLE" and seen[0]["interval"] == "1m"
    rows = list(csv.DictReader(StringIO(response["csvText"])))
    assert [row["timestamp"] for row in rows] == [
        "2026-11-01T00:00:00.000000Z",
        "2026-11-01T23:59:59.000000Z",
    ]
    assert all(row["volume"] == row["openInterest"] == "" for row in rows)
    assert not response["empty"]


def test_changed_provider_or_unsupported_interval_is_denied_before_history_fetch(monkeypatch):
    bind_stub(monkeypatch)
    monkeypatch.setattr(
        history_service,
        "get_history",
        lambda **_: pytest.fail("Binding/interval mismatch reached the provider"),
    )
    changed = request()
    changed["context"]["provider"] = "different-provider"
    with pytest.raises(DownloadFetchError, match="provider_binding_changed"):
        dataset_provider.fetch_owner_history(changed)
    changed = request()
    changed["context"]["interval"] = "5m"
    with pytest.raises(DownloadFetchError, match="interval_not_supported"):
        dataset_provider.fetch_owner_history(changed)


def test_missing_binding_is_denied_before_history_fetch(monkeypatch):
    monkeypatch.setattr(dataset_provider, "_owner_binding", lambda *args: None)
    monkeypatch.setattr(
        history_service,
        "get_history",
        lambda **_: pytest.fail("Missing binding reached the provider"),
    )
    with pytest.raises(DownloadFetchError) as caught:
        dataset_provider.fetch_owner_history(request())
    assert caught.value.status == 403


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        [None],
        [{"open": 1}],
        [{"timestamp": True}],
        [{"timestamp": "NaN"}],
        [{"timestamp": "1.123456789"}],
        [candle()] * 50001,
    ],
)
def test_malformed_provider_rows_do_not_become_silent_empty_or_valid_candles(monkeypatch, data):
    bind_stub(monkeypatch)
    monkeypatch.setattr(history_service, "get_history", lambda **_: (True, {"data": data}, 200))
    with pytest.raises(DownloadFetchError) as caught:
        dataset_provider.fetch_owner_history(request())
    assert caught.value.code == "dataset.provider_invalid_response" and caught.value.status == 502


def test_rate_limit_status_and_retry_after_propagate_without_raw_provider_message(monkeypatch):
    bind_stub(monkeypatch)
    monkeypatch.setattr(
        history_service,
        "get_history",
        lambda **_: (
            False,
            {"retryAfter": "30", "message": "fixture secret should not escape"},
            429,
        ),
    )
    with pytest.raises(DownloadFetchError) as caught:
        dataset_provider.fetch_owner_history(request())
    assert caught.value.status == 429 and caught.value.retry_after_seconds == "30"
    assert "secret" not in str(caught.value)


def test_successful_no_row_response_is_explicitly_empty(monkeypatch):
    bind_stub(monkeypatch)
    monkeypatch.setattr(history_service, "get_history", lambda **_: (True, {"data": []}, 200))
    result = dataset_provider.fetch_owner_history(request())
    assert result["empty"] is True and list(csv.DictReader(StringIO(result["csvText"]))) == []


def test_broker_store_failure_does_not_block_authenticated_local_catalog(api, monkeypatch):
    from blueprints.data_library import data_library_bp

    class Unavailable:
        def connect(self):
            raise OperationalError("fixture unavailable", {}, RuntimeError("fixture"))

    api.register_blueprint(data_library_bp)
    monkeypatch.setattr(auth_db, "engine", Unavailable())
    with api.test_client() as client:
        login(client)
        response = client.get("/api/local/v1/datasets")
        assert response.status_code == 200, response.json
        assert response.json["versions"] == []
        assert not response.json["capabilities"]["downloads"]["available"]
        assert "Local CSV" in response.json["capabilities"]["downloads"]["reason"]


def test_bridge_formats_decimal_numeric_values_for_the_selected_mapping(monkeypatch):
    bind_stub(monkeypatch)
    values = {"open": 1.234, "high": 1.234, "low": 1.234, "close": 1.234, "volume": None}
    monkeypatch.setattr(
        history_service, "get_history", lambda **_: (True, {"data": [candle(**values)]}, 200)
    )
    value = request()
    value["mapping"].update(delimiter=";", decimalSeparator=",", thousandsSeparator=".")
    result = dataset_provider.fetch_owner_history(value)
    preview = normalize_history(result["csvText"], value["mapping"], value["context"])
    assert preview["canCommit"] and preview["bars"][0]["close"] == "1.234"
    assert preview["bars"][0]["volume"] is None


def test_bridge_emits_small_crypto_prices_as_plain_decimals(monkeypatch):
    bind_stub(monkeypatch)
    values = dict.fromkeys(("open", "high", "low", "close"), 1e-08)
    monkeypatch.setattr(
        history_service, "get_history", lambda **_: (True, {"data": [candle(**values)]}, 200)
    )
    value = request()
    result = dataset_provider.fetch_owner_history(value)
    preview = normalize_history(result["csvText"], value["mapping"], value["context"])
    assert preview["canCommit"] and preview["bars"][0]["close"] == "0.00000001"


def test_provider_change_during_fetch_cannot_publish_under_old_source(monkeypatch):
    state = bind_stub(monkeypatch)

    def fetch(**_kwargs):
        state["provider"] = "different-provider"
        return True, {"data": [candle()]}, 200

    monkeypatch.setattr(history_service, "get_history", fetch)
    with pytest.raises(DownloadFetchError, match="provider_binding_changed"):
        dataset_provider.fetch_owner_history(request())


def test_provider_date_request_covers_non_midnight_utc_chunk_despite_mapping_timezone(monkeypatch):
    bind_stub(monkeypatch)
    rows = [candle("2026-11-01T02:00:00Z"), candle("2026-11-02T01:00:00Z")]

    def fetch(**kwargs):
        # A legitimate provider interpreting its documented dates in UTC.
        selected = [
            row
            for row in rows
            if kwargs["start_date"]
            <= datetime.fromtimestamp(row["timestamp"], UTC).date().isoformat()
            <= kwargs["end_date"]
        ]
        return True, {"data": selected}, 200

    monkeypatch.setattr(history_service, "get_history", fetch)
    value = request(startAt="2026-11-01T02:00:00Z", endAt="2026-11-02T02:00:00Z")
    value["mapping"]["timezone"] = "America/New_York"
    result = dataset_provider.fetch_owner_history(value)
    assert len(list(csv.DictReader(StringIO(result["csvText"])))) == 2
