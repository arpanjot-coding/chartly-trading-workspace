"""Resolve the verified terminal identity for a live profile."""

import json

from sqlalchemy import func, select

from database.connectors_db import connectors
from database.workspace_storage_db import TABLES
from services.workspace_storage import WorkspaceError, digest, valid_id, valid_origin


def profile_mt5_binding(storage, origin_id, profile_id):
    if not valid_origin(origin_id) or not valid_id(profile_id):
        raise WorkspaceError("mt5.profile_binding_required", 409)

    profiles, accounts = TABLES["portfolios"], TABLES["brokerAccounts"]
    payload = connectors.c.payload
    with storage.engine.connect() as connection:
        connection.exec_driver_sql("BEGIN")
        principal = storage._principal(connection)
        if not principal or principal["active_origin"] != origin_id:
            raise WorkspaceError("mt5.profile_binding_changed", 409)
        kind = connection.execute(
            select(func.json_extract(profiles.c.payload, "$.kind")).where(
                storage.scope(profiles, origin_id),
                profiles.c.id == profile_id,
                func.json_extract(profiles.c.payload, "$.archivedAt").is_(None),
            )
        ).scalar_one_or_none()
        if kind != "live":
            raise WorkspaceError("mt5.profile_binding_required", 409)
        # Select only binding metadata. The connection may also have a large deal ledger.
        links = connection.execute(
            select(
                connectors.c.id,
                func.json_extract(payload, "$.identity"),
                func.json_extract(payload, "$.configuration"),
                func.json_extract(payload, "$.verifiedConfigHash"),
                func.json_extract(payload, "$.permissions"),
                func.json_extract(payload, "$.status"),
                func.json_extract(payload, "$.requiresVerification"),
                func.json_extract(payload, "$.link.accountId"),
                func.json_extract(payload, "$.revision"),
            )
            .where(
                storage.scope(connectors, origin_id),
                func.json_extract(payload, "$.providerId") == "mt5",
                func.json_extract(payload, "$.link.profileId") == profile_id,
                func.json_extract(payload, "$.link.active") == 1,
            )
            .limit(2)
        ).all()
        if len(links) > 1:
            raise WorkspaceError("mt5.profile_binding_ambiguous", 409)
        if not links:
            raise WorkspaceError("mt5.profile_binding_required", 409)
        (
            link_id,
            raw_identity,
            raw_config,
            verified,
            permissions,
            status,
            needs_check,
            account_id,
            revision,
        ) = links[0]
        active_account = connection.execute(
            select(accounts.c.id).where(
                storage.scope(accounts, origin_id),
                accounts.c.id == account_id,
                func.json_extract(accounts.c.payload, "$.archivedAt").is_(None),
            )
        ).scalar_one_or_none()
        config = json.loads(raw_config or "{}")
        if (
            status != "linked"
            or needs_check
            or not active_account
            or not raw_identity
            or verified != digest(config)
            or "accountRead" not in json.loads(permissions or "[]")
        ):
            raise WorkspaceError("mt5.profile_binding_required", 409)
        return {
            "scope": {
                "originId": origin_id,
                "profileId": profile_id,
                "connectionId": link_id,
                "revision": revision,
                "generation": principal["generation"],
            },
            "identity": json.loads(raw_identity),
            "configuration": config,
        }
