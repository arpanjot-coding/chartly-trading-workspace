"""Only temporary databases are migrated; credential bytes and IDs survive."""

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from sqlalchemy import event, inspect, text

from database.engine_factory import create_db_engine
from database.user_db import ensure_user_identity_schema


@pytest.fixture
def legacy(tmp_path):
    path = tmp_path / "legacy-users.db"
    engine = create_db_engine(f"sqlite:///{path.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(80) UNIQUE, password_hash TEXT, totp_secret TEXT)"
        )
        connection.execute(
            text(
                "INSERT INTO users (id,username,password_hash,totp_secret) VALUES (:id,:name,:password,:factor)"
            ),
            [
                {
                    "id": 1,
                    "name": "alpha",
                    "password": "fixture-argon-hash-alpha",
                    "factor": "fixture-encrypted-totp-alpha",
                },
                {
                    "id": 2,
                    "name": "beta",
                    "password": "fixture-argon-hash-beta",
                    "factor": "fixture-encrypted-totp-beta",
                },
            ],
        )
    yield engine, path, tmp_path
    engine.dispose()


def test_additive_backfill_has_verified_recovery_copy_and_is_repeatable(legacy):
    engine, path, folder = legacy
    backup = ensure_user_identity_schema(engine, backup_dir=folder / "recovery")
    assert backup is not None and backup.is_file()
    with closing(sqlite3.connect(backup)) as connection:
        assert connection.execute("SELECT * FROM users ORDER BY id").fetchall() == [
            (1, "alpha", "fixture-argon-hash-alpha", "fixture-encrypted-totp-alpha"),
            (2, "beta", "fixture-argon-hash-beta", "fixture-encrypted-totp-beta"),
        ]
        assert "identity_uid" not in [
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        ]
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT * FROM users ORDER BY id")).mappings().all()
    assert len({row["identity_uid"] for row in rows}) == 2
    assert all(row["identity_uid"].startswith("principal_") for row in rows)
    assert [
        (row["id"], row["username"], row["password_hash"], row["totp_secret"]) for row in rows
    ] == [
        (1, "alpha", "fixture-argon-hash-alpha", "fixture-encrypted-totp-alpha"),
        (2, "beta", "fixture-argon-hash-beta", "fixture-encrypted-totp-beta"),
    ]
    assert ensure_user_identity_schema(engine, backup_dir=folder / "recovery") is None
    with engine.connect() as connection:
        assert [
            row[0] for row in connection.execute(text("SELECT identity_uid FROM users ORDER BY id"))
        ] == [row["identity_uid"] for row in rows]
    assert len(list((folder / "recovery").iterdir())) == 1


def test_backup_failure_changes_no_schema_or_record(legacy, monkeypatch):
    import database.user_db as users

    engine, _, _ = legacy

    def fail(*_args, **_kwargs):
        raise OSError("Injected backup disk failure")

    monkeypatch.setattr(users, "_identity_backup", fail)
    with pytest.raises(OSError, match="backup disk"):
        ensure_user_identity_schema(engine)
    assert "identity_uid" not in {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one() == 2


def test_interrupted_ddl_rolls_back_and_backup_remains(legacy):
    engine, _, folder = legacy

    def interrupt(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.startswith("UPDATE users SET identity_uid"):
            raise RuntimeError("Injected interruption")

    event.listen(engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="interruption"):
            ensure_user_identity_schema(engine, backup_dir=folder / "recover")
    finally:
        event.remove(engine, "before_cursor_execute", interrupt)
    assert "identity_uid" not in {column["name"] for column in inspect(engine).get_columns("users")}
    assert len(list((folder / "recover").glob("*.sqlite3"))) == 1
    ensure_user_identity_schema(engine, backup_dir=folder / "recover")


def test_renaming_and_password_change_preserve_principal(legacy):
    engine, _, _ = legacy
    ensure_user_identity_schema(engine)
    with engine.begin() as connection:
        before = connection.execute(text("SELECT identity_uid FROM users WHERE id=1")).scalar_one()
        connection.execute(
            text("UPDATE users SET username='renamed',password_hash='new fixture hash' WHERE id=1")
        )
    ensure_user_identity_schema(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT identity_uid FROM users WHERE id=1")).scalar_one()
            == before
        )


def test_duplicate_identity_is_rejected_without_reassignment(legacy):
    engine, _, _ = legacy
    uid = "principal_" + "a" * 32
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE users ADD COLUMN identity_uid VARCHAR(64)")
        connection.execute(text("UPDATE users SET identity_uid=:uid"), {"uid": uid})
    with pytest.raises(RuntimeError, match="invalid_existing_identity"):
        ensure_user_identity_schema(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM users WHERE identity_uid=:uid"), {"uid": uid}
            ).scalar_one()
            == 2
        )


def test_uid_index_blocks_reuse(legacy):
    from sqlalchemy.exc import IntegrityError

    engine, _, _ = legacy
    ensure_user_identity_schema(engine)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        uid = connection.execute(text("SELECT identity_uid FROM users WHERE id=1")).scalar_one()
        connection.execute(text("UPDATE users SET identity_uid=:uid WHERE id=2"), {"uid": uid})
