"""Scoped research issuer bundles and ingestion jobs (P13-T03)."""

from sqlalchemy import Column, ForeignKeyConstraint, String, Table, Text

from database.workspace_storage_db import metadata


def _scoped(name):
    return Table(
        name,
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


research_issuers = _scoped("workspace_research_issuers")
research_ingestion_jobs = _scoped("workspace_research_ingestion")
