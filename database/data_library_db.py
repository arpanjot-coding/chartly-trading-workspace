"""P04 principal-owned dataset metadata; candle bytes stay in immutable DuckDB files."""

from sqlalchemy import Column, ForeignKeyConstraint, Integer, String, Table, Text

from database.workspace_storage_db import metadata

library_states = Table(
    "data_library_states",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("revision", Integer, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
datasets = Table(
    "data_library_datasets",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
versions = Table(
    "data_library_versions",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("dataset_id", String(128), nullable=False),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "dataset_id"],
        ["data_library_datasets.uid", "data_library_datasets.id"],
        ondelete="RESTRICT",
    ),
)
records = Table(
    "data_library_records",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("kind", String(32), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("version_id", String(128)),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
    ForeignKeyConstraint(
        ["uid", "version_id"],
        ["data_library_versions.uid", "data_library_versions.id"],
        ondelete="RESTRICT",
    ),
)
