"""Scoped connector metadata and observed history; credentials live separately."""

from sqlalchemy import Column, ForeignKeyConstraint, String, Table, Text

from database.workspace_storage_db import metadata

connectors = Table(
    "workspace_connectors",
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
