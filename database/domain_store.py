"""Explicitly initialized, file-backed local-core storage.

Importing this module creates no engine, files, tables or background work.
The first P02 slice supports journal identities and manual records. It does not
replace the app's browser stores until migration and recovery are accepted.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    and_,
    event,
    inspect,
    select,
)
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.pool import NullPool

from database.engine_factory import create_db_engine

metadata = MetaData()
store_version = Table(
    "domain_schema",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("version", Integer, nullable=False),
    CheckConstraint("id = 1"),
)
entities = Table(
    "domain_entities",
    metadata,
    Column("id", String(128), primary_key=True),
    Column("record_type", String(64), nullable=False),
    Column("owner_id", String(128)),
    Column("workspace_id", String(128)),
    UniqueConstraint("id", "record_type"),
    UniqueConstraint("owner_id", "workspace_id", "id", "record_type"),
)


def _common(kind: str, scope: str = "workspace"):
    columns = [
        Column("id", String(128), primary_key=True),
        Column("record_type", String(64), nullable=False),
        Column("revision", BigInteger, nullable=False),
        Column("payload", Text, nullable=False),
        CheckConstraint(f"record_type = '{kind}'"),
        CheckConstraint("revision >= 1"),
        ForeignKeyConstraint(
            ["id", "record_type"],
            ["domain_entities.id", "domain_entities.record_type"],
            ondelete="RESTRICT",
        ),
    ]
    if scope != "owner":
        columns.append(Column("owner_id", String(128), nullable=False))
    if scope == "workspace":
        columns.extend(
            [
                Column("workspace_id", String(128), nullable=False),
                ForeignKeyConstraint(
                    ["owner_id", "workspace_id"],
                    ["domain_workspaces.owner_id", "domain_workspaces.id"],
                    ondelete="RESTRICT",
                ),
                UniqueConstraint("owner_id", "workspace_id", "id"),
                ForeignKeyConstraint(
                    ["owner_id", "workspace_id", "id", "record_type"],
                    [
                        "domain_entities.owner_id",
                        "domain_entities.workspace_id",
                        "domain_entities.id",
                        "domain_entities.record_type",
                    ],
                    ondelete="RESTRICT",
                ),
            ]
        )
    return columns


owners = Table("domain_owners", metadata, *_common("LocalOwner", "owner"))
workspaces = Table(
    "domain_workspaces",
    metadata,
    *_common("Workspace", "root"),
    ForeignKeyConstraint(["owner_id"], ["domain_owners.id"], ondelete="RESTRICT"),
    UniqueConstraint("owner_id", "id"),
)
accounts = Table(
    "domain_accounts",
    metadata,
    *_common("Account"),
    Column("kind", String(20), nullable=False),
    Column("mode", String(24), nullable=False),
    Column("provider_id", String(500)),
    Column("venue", String(500)),
    Column("external_identity", String(500)),
    UniqueConstraint("owner_id", "workspace_id", "id", "kind"),
    UniqueConstraint(
        "owner_id", "workspace_id", "provider_id", "venue", "external_identity", "mode"
    ),
    CheckConstraint("kind IN ('external', 'simulated')"),
)
books = Table(
    "domain_books",
    metadata,
    *_common("JournalBook"),
    Column("kind", String(20), nullable=False),
    Column("state", String(20), nullable=False),
    Column("account_id", String(128)),
    Column("account_kind", String(20)),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "account_id", "account_kind"],
        [
            "domain_accounts.owner_id",
            "domain_accounts.workspace_id",
            "domain_accounts.id",
            "domain_accounts.kind",
        ],
        ondelete="RESTRICT",
    ),
    UniqueConstraint("owner_id", "workspace_id", "id", "kind"),
    UniqueConstraint("owner_id", "workspace_id", "id", "account_id"),
    CheckConstraint("state IN ('active', 'archived')"),
    CheckConstraint(
        "(kind = 'manual' AND account_id IS NULL AND account_kind IS NULL) OR (kind = 'connected' AND account_id IS NOT NULL AND account_kind = 'external') OR (kind = 'paper' AND account_id IS NOT NULL AND account_kind = 'simulated')"
    ),
)
for kind in ("connected", "paper"):
    Index(
        f"uq_domain_active_{kind}_book",
        books.c.owner_id,
        books.c.workspace_id,
        books.c.account_id,
        unique=True,
        sqlite_where=and_(books.c.kind == kind, books.c.state == "active"),
    )

profiles = Table(
    "domain_profiles",
    metadata,
    *_common("Profile"),
    Column("primary_book_id", String(128)),
    Column("primary_account_id", String(128)),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "primary_book_id"],
        ["domain_books.owner_id", "domain_books.workspace_id", "domain_books.id"],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "primary_account_id"],
        ["domain_accounts.owner_id", "domain_accounts.workspace_id", "domain_accounts.id"],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "primary_book_id", "primary_account_id"],
        [
            "domain_books.owner_id",
            "domain_books.workspace_id",
            "domain_books.id",
            "domain_books.account_id",
        ],
        ondelete="RESTRICT",
    ),
)
manual_trades = Table(
    "domain_manual_trades",
    metadata,
    *_common("ManualTrade"),
    Column("book_id", String(128), nullable=False),
    Column("book_kind", String(20), nullable=False),
    CheckConstraint("book_kind = 'manual'"),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "book_id", "book_kind"],
        [
            "domain_books.owner_id",
            "domain_books.workspace_id",
            "domain_books.id",
            "domain_books.kind",
        ],
        ondelete="RESTRICT",
    ),
    UniqueConstraint("owner_id", "workspace_id", "id", "book_id"),
)
journal_entries = Table(
    "domain_journal_entries",
    metadata,
    *_common("JournalEntry"),
    Column("book_id", String(128), nullable=False),
    Column("manual_trade_id", String(128), nullable=False),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "book_id"],
        ["domain_books.owner_id", "domain_books.workspace_id", "domain_books.id"],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "manual_trade_id", "book_id"],
        [
            "domain_manual_trades.owner_id",
            "domain_manual_trades.workspace_id",
            "domain_manual_trades.id",
            "domain_manual_trades.book_id",
        ],
        ondelete="RESTRICT",
    ),
    UniqueConstraint("owner_id", "workspace_id", "book_id", "manual_trade_id"),
)
profile_books = Table(
    "domain_profile_books",
    metadata,
    Column("owner_id", String(128), primary_key=True),
    Column("workspace_id", String(128), primary_key=True),
    Column("profile_id", String(128), primary_key=True),
    Column("book_id", String(128), primary_key=True),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "profile_id"],
        ["domain_profiles.owner_id", "domain_profiles.workspace_id", "domain_profiles.id"],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "book_id"],
        ["domain_books.owner_id", "domain_books.workspace_id", "domain_books.id"],
        ondelete="RESTRICT",
    ),
)
aliases = Table(
    "domain_aliases",
    metadata,
    Column("owner_id", String(128), primary_key=True),
    Column("workspace_id", String(128), primary_key=True),
    Column("namespace", String(500), primary_key=True),
    Column("legacy_key", String(500), primary_key=True),
    Column("entity_id", String(128), nullable=False),
    Column("record_type", String(64), nullable=False),
    ForeignKeyConstraint(
        ["entity_id", "record_type"],
        ["domain_entities.id", "domain_entities.record_type"],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id", "entity_id", "record_type"],
        [
            "domain_entities.owner_id",
            "domain_entities.workspace_id",
            "domain_entities.id",
            "domain_entities.record_type",
        ],
        ondelete="RESTRICT",
    ),
    ForeignKeyConstraint(
        ["owner_id", "workspace_id"],
        ["domain_workspaces.owner_id", "domain_workspaces.id"],
        ondelete="RESTRICT",
    ),
)

TABLES = {
    "LocalOwner": owners,
    "Workspace": workspaces,
    "Account": accounts,
    "JournalBook": books,
    "Profile": profiles,
    "ManualTrade": manual_trades,
    "JournalEntry": journal_entries,
}


def create_domain_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    if (
        url.get_backend_name() != "sqlite"
        or not url.database
        or url.database == ":memory:"
        or url.database.startswith("file:")
        or url.query.get("mode") == "memory"
        or url.query.get("uri")
    ):
        raise ValueError("storage.file_sqlite_required")
    engine = create_db_engine(database_url)

    def configure(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA synchronous=FULL")
            if cursor.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                raise RuntimeError("storage.foreign_keys_unavailable")
        finally:
            cursor.close()

    event.listen(engine, "connect", configure)
    return engine


def initialize_store(engine: Engine) -> None:
    """Atomic schema bootstrap, called explicitly against the selected local DB."""
    if engine.dialect.name != "sqlite" or not isinstance(engine.pool, NullPool):
        raise ValueError("storage.file_sqlite_required")
    with engine.connect() as connection:
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 1:
            raise ValueError("storage.foreign_keys_unavailable")
        connection.commit()
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            exists = connection.exec_driver_sql(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='domain_schema'"
            ).first()
            if exists:
                version = connection.execute(
                    select(store_version.c.version).where(store_version.c.id == 1)
                ).scalar_one_or_none()
                if version != 1:
                    raise ValueError("storage.unsupported_schema")
                schema = inspect(connection)
                if not set(metadata.tables).issubset(schema.get_table_names()):
                    raise ValueError("storage.incomplete_schema")
                for name, table in metadata.tables.items():
                    if {column["name"] for column in schema.get_columns(name)} != set(
                        table.c.keys()
                    ):
                        raise ValueError("storage.incomplete_schema")
                    expected_foreign = {
                        (
                            tuple(element.parent.name for element in fk.elements),
                            fk.referred_table.name,
                            tuple(element.column.name for element in fk.elements),
                            (fk.ondelete or "").upper(),
                        )
                        for fk in table.foreign_key_constraints
                    }
                    actual_foreign = {
                        (
                            tuple(fk["constrained_columns"]),
                            fk["referred_table"],
                            tuple(fk["referred_columns"]),
                            (fk.get("options", {}).get("ondelete") or "").upper(),
                        )
                        for fk in schema.get_foreign_keys(name)
                    }
                    if expected_foreign != actual_foreign:
                        raise ValueError("storage.incomplete_schema")
                    actual_unique = {
                        tuple(item["column_names"]) for item in schema.get_unique_constraints(name)
                    }
                    expected_unique = {
                        tuple(column.name for column in item.columns)
                        for item in table.constraints
                        if isinstance(item, UniqueConstraint)
                    }
                    if actual_unique != expected_unique:
                        raise ValueError("storage.incomplete_schema")
                    actual_indexes = {item["name"]: item for item in schema.get_indexes(name)}
                    for index in table.indexes:
                        actual = actual_indexes.get(index.name)
                        if (
                            not actual
                            or bool(actual["unique"]) != bool(index.unique)
                            or actual["column_names"] != [column.name for column in index.columns]
                        ):
                            raise ValueError("storage.incomplete_schema")
                        predicate = index.dialect_options["sqlite"].get("where")
                        expected_where = (
                            ""
                            if predicate is None
                            else str(
                                predicate.compile(
                                    dialect=engine.dialect,
                                    compile_kwargs={"literal_binds": True, "include_table": False},
                                )
                            )
                        )
                        actual_where = str(
                            actual.get("dialect_options", {}).get("sqlite_where", "")
                        )
                        if "".join(expected_where.split()) != "".join(actual_where.split()):
                            raise ValueError("storage.incomplete_schema")
            elif any(name.startswith("domain_") for name in inspect(connection).get_table_names()):
                raise ValueError("storage.incomplete_schema")
            metadata.create_all(connection)
            if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
                raise ValueError("storage.integrity_conflict")
            if not exists:
                connection.execute(store_version.insert().values(id=1, version=1))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
