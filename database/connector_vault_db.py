"""Nonportable encrypted connector credentials, excluded from workspace backups."""

from sqlalchemy import Column, ForeignKeyConstraint, Integer, String, Table, Text

from database.workspace_storage_db import metadata

connector_secrets = Table(
    "workspace_connector_secrets",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("connection_id", String(128), primary_key=True),
    Column("reference", String(128), nullable=False),
    Column("generation", Integer, nullable=False),
    Column("ciphertext", Text, nullable=False),
    Column("expires_at", String(80)),
    Column("revoked_at", String(80)),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
