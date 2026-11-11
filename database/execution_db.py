"""Scoped per-account execution bundles (P11-T02)."""

from sqlalchemy import Column, ForeignKeyConstraint, String, Table, Text

from database.workspace_storage_db import metadata

deployments = Table(
    "workspace_deployments",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"],
        ["workspace_states.uid", "workspace_states.origin"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)

execution_accounts = Table(
    "workspace_execution_accounts",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"],
        ["workspace_states.uid", "workspace_states.origin"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)
