"""P02 durable compatibility records and migration/recovery receipts.

Numeric browser IDs remain scoped to principal + origin. All parent links are
real deferred foreign keys; retained archived rows are never cascade-deleted.
"""

from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    event,
)

from database.engine_factory import create_db_engine

metadata = MetaData()
principals = Table(
    "workspace_principals",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("generation", Integer, nullable=False),
    Column("active_origin", String(128)),
)
states = Table(
    "workspace_states",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("revision", Integer, nullable=False),
    Column("state_revision", Integer, nullable=False),
    Column("snapshot_meta", Text, nullable=False),
    Column("bindings", Text, nullable=False),
    Column("native_mappings", Text, nullable=False, default="{}"),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)


def table(name, links):
    columns = [
        Column("uid", String(128), primary_key=True),
        Column("origin", String(128), primary_key=True),
        Column("id", Integer, primary_key=True),
        Column("payload", Text, nullable=False),
        ForeignKeyConstraint(
            ["uid", "origin"],
            ["workspace_states.uid", "workspace_states.origin"],
            ondelete="RESTRICT",
        ),
    ]
    for field, parent, required in links:
        columns.extend(
            [
                Column(field, Integer, nullable=not required),
                ForeignKeyConstraint(
                    ["uid", "origin", field],
                    [
                        f"workspace_{parent}.uid",
                        f"workspace_{parent}.origin",
                        f"workspace_{parent}.id",
                    ],
                    ondelete="RESTRICT",
                    deferrable=True,
                    initially="DEFERRED",
                ),
            ]
        )
    return Table("workspace_" + name, metadata, *columns)


TABLES = {
    "portfolios": table("portfolios", []),
    "brokerAccounts": table("brokerAccounts", []),
    "practiceSessions": table("practiceSessions", [("portfolioId", "portfolios", True)]),
    "terminals": table("terminals", [("assignedAccountId", "brokerAccounts", False)]),
    "journalTrades": table(
        "journalTrades",
        [
            ("portfolioId", "portfolios", True),
            ("sessionId", "practiceSessions", False),
            ("accountId", "brokerAccounts", False),
        ],
    ),
    "dailyMoods": table("dailyMoods", [("portfolioId", "portfolios", True)]),
    "profileDestinations": table(
        "profileDestinations",
        [
            ("portfolioId", "portfolios", True),
            ("accountId", "brokerAccounts", True),
            ("terminalId", "terminals", False),
        ],
    ),
}
aliases = Table(
    "workspace_aliases",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("table_name", String(40), primary_key=True),
    Column("legacy_id", Integer, primary_key=True),
    Column("canonical_id", String(128), nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"], ["workspace_states.uid", "workspace_states.origin"], ondelete="RESTRICT"
    ),
)
book_registry = Table(
    "workspace_books",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("account_key", String(128)),
    Column("kind", String(20), nullable=False),
    Column("payload", Text, nullable=False),
    UniqueConstraint("uid", "account_key"),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
jobs = Table(
    "workspace_jobs",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("kind", String(30), nullable=False),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
receipts = Table(
    "workspace_receipts",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("request_id", String(128), primary_key=True),
    Column("operation", String(30), nullable=False),
    Column("input_hash", String(64), nullable=False),
    Column("response", Text, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
recovery_copies = Table(
    "workspace_recovery_copies",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(["uid"], ["workspace_principals.uid"], ondelete="RESTRICT"),
)
assets = Table(
    "workspace_assets",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("mime_type", String(120), nullable=False),
    Column("source", Text),
    Column("content", LargeBinary, nullable=False),
    Column("sha256", String(64), nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"],
        ["workspace_states.uid", "workspace_states.origin"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)
native_catalogs = Table(
    "workspace_native_catalogs",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("database", String(80), primary_key=True),
    Column("namespace", String(300), primary_key=True),
    Column("revision", Integer, nullable=False),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"],
        ["workspace_states.uid", "workspace_states.origin"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)


journal_records = Table(
    "workspace_journal_records",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("origin", String(128), primary_key=True),
    Column("kind", String(30), primary_key=True),
    Column("id", String(160), primary_key=True),
    Column("trade_id", Integer),
    Column("book_id", String(128)),
    Column("payload", Text, nullable=False),
    ForeignKeyConstraint(
        ["uid", "origin"],
        ["workspace_states.uid", "workspace_states.origin"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
    ForeignKeyConstraint(
        ["uid", "origin", "trade_id"],
        [
            "workspace_journalTrades.uid",
            "workspace_journalTrades.origin",
            "workspace_journalTrades.id",
        ],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
    ForeignKeyConstraint(
        ["uid", "book_id"],
        ["workspace_books.uid", "workspace_books.id"],
        ondelete="RESTRICT",
        deferrable=True,
        initially="DEFERRED",
    ),
)


def create_workspace_engine(url):
    from sqlalchemy.engine import make_url

    parsed = make_url(url)
    if (
        parsed.get_backend_name() != "sqlite"
        or not parsed.database
        or parsed.database == ":memory:"
        or parsed.database.startswith("file:")
        or parsed.query
    ):
        raise ValueError("workspace.file_sqlite_required")
    engine = create_db_engine(url)

    @event.listens_for(engine, "connect")
    def configure(connection, _record):
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA synchronous=FULL")
        finally:
            cursor.close()

    with engine.begin() as connection:
        metadata.create_all(connection)
    return engine
