"""Scoped durable historical paper ledgers; no market or broker resources."""

from sqlalchemy import Column, ForeignKeyConstraint, Integer, String, Table, Text

from database.workspace_storage_db import metadata

paper_sessions = Table(
    "workspace_paper_sessions",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("run_id", Integer, primary_key=True),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin", "run_id"],
        [
            "workspace_practiceSessions.uid",
            "workspace_practiceSessions.origin",
            "workspace_practiceSessions.id",
        ],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)
