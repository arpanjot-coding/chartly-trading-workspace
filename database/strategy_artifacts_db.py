"""Scoped Strategy Builder artifact bundles (P20-T02); one row per project."""

from sqlalchemy import Column, ForeignKeyConstraint, String, Table, Text

from database.workspace_storage_db import metadata

strategy_artifacts = Table(
    "workspace_strategy_artifacts",
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
