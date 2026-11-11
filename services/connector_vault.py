"""Scope-authenticated encrypted local vault. No plaintext read/export endpoint."""

import base64
import json
import os
from datetime import UTC, datetime

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import delete, insert, select, update

from database.connector_vault_db import connector_secrets
from services.workspace_storage import WorkspaceError, dumps, now, opaque, valid_origin

SECRET_FIELDS = frozenset({"apiKey", "apiSecret", "accessToken", "refreshToken", "password"})


def validate_secret(secret):
    if (
        not isinstance(secret, dict)
        or not secret
        or set(secret) - SECRET_FIELDS
        or any(
            not isinstance(value, str) or not 1 <= len(value) <= 4096 or "\x00" in value
            for value in secret.values()
        )
        or len(dumps(secret).encode()) > 16384
    ):
        raise WorkspaceError("connector.invalid_secret")
    return dict(secret)


class ConnectorVault:
    def __init__(self, storage, *, master_key=None):
        self.storage = storage
        self.master_key = master_key
        connector_secrets.create(storage.engine, checkfirst=True)

    def _cipher(self):
        value = self.master_key if self.master_key is not None else os.environ.get("APP_KEY")
        if not isinstance(value, str) or len(value) < 32:
            raise WorkspaceError("connector.vault_key_unavailable", 503)
        key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=("chartly:connector-vault:v1:" + self.storage.uid).encode(),
        ).derive(value.encode())
        return Fernet(base64.urlsafe_b64encode(key))

    def _where(self, origin, connection_id):
        if not valid_origin(origin) or not valid_origin(connection_id):
            raise WorkspaceError("connector.invalid_identity")
        return (
            connector_secrets.c.uid == self.storage.uid,
            connector_secrets.c.origin == origin,
            connector_secrets.c.connection_id == connection_id,
        )

    def save(self, connection, origin, connection_id, secret, generation, expires_at=None):
        secret = validate_secret(secret)
        if type(generation) is not int or not 1 <= generation <= 9007199254740991:
            raise WorkspaceError("connector.invalid_generation")
        if expires_at is not None:
            try:
                instant = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if instant.tzinfo is None or instant <= datetime.now(UTC):
                    raise ValueError()
                expires_at = instant.astimezone(UTC).isoformat().replace("+00:00", "Z")
            except (AttributeError, ValueError, TypeError) as error:
                raise WorkspaceError("connector.invalid_expiry") from error
        reference = opaque("credential", f"{self.storage.uid}|{origin}|{connection_id}")
        envelope = {
            "version": 1,
            "ownerId": self.storage.uid,
            "originId": origin,
            "connectionId": connection_id,
            "generation": generation,
            "expiresAt": expires_at,
            "secret": secret,
        }
        ciphertext = self._cipher().encrypt(dumps(envelope).encode()).decode("ascii")
        connection.execute(delete(connector_secrets).where(*self._where(origin, connection_id)))
        connection.execute(
            insert(connector_secrets).values(
                uid=self.storage.uid,
                origin=origin,
                connection_id=connection_id,
                reference=reference,
                generation=generation,
                ciphertext=ciphertext,
                expires_at=expires_at,
                revoked_at=None,
            )
        )
        return reference

    def status(self, connection, origin, record):
        if not record.get("credentialRef"):
            return {
                "status": "not_required"
                if record["providerId"] in {"mt5", "diagnostic", "kraken-public"}
                else "missing",
                "generation": record.get("credentialGeneration", 0),
            }
        row = (
            connection.execute(select(connector_secrets).where(*self._where(origin, record["id"])))
            .mappings()
            .first()
        )
        status = "missing"
        if (
            row
            and row["reference"] == record["credentialRef"]
            and row["generation"] == record.get("credentialGeneration")
        ):
            status = "revoked" if row["revoked_at"] else "stored"
            if row["expires_at"] and datetime.fromisoformat(
                row["expires_at"].replace("Z", "+00:00")
            ) <= datetime.now(UTC):
                status = "expired"
        return {"status": status, "generation": record.get("credentialGeneration", 0)}

    def load(self, connection, origin, record):
        status = self.status(connection, origin, record)
        if status["status"] != "stored":
            raise WorkspaceError("connector.credential_" + status["status"], 403)
        row = (
            connection.execute(select(connector_secrets).where(*self._where(origin, record["id"])))
            .mappings()
            .one()
        )
        try:
            value = json.loads(self._cipher().decrypt(row["ciphertext"].encode()))
            expected = (
                self.storage.uid,
                origin,
                record["id"],
                record["credentialGeneration"],
                row["expires_at"],
            )
            observed = tuple(
                value.get(key)
                for key in ("ownerId", "originId", "connectionId", "generation", "expiresAt")
            )
            if value.get("version") != 1 or observed != expected:
                raise ValueError()
            return validate_secret(value["secret"])
        except (InvalidToken, ValueError, KeyError, TypeError, UnicodeError) as error:
            raise WorkspaceError("connector.credential_unavailable", 403) from error

    def revoke(self, connection, origin, connection_id):
        connection.execute(
            update(connector_secrets)
            .where(*self._where(origin, connection_id))
            .values(revoked_at=now(), ciphertext="")
        )
