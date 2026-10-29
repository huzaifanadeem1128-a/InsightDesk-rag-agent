import pytest

from database import Database
from migrations import (
    column_exists,
    add_column_if_missing,
)


def _apply_migrations(db: Database) -> None:
    """
    Bring a fresh test database up to the current schema.
    Mirrors the logic in migrations.py but on the fixture's DB path.
    """
    conn = db.connect()
    cur = conn.cursor()

    # Columns added over time.
    add_column_if_missing(cur, "users", "role", "TEXT NOT NULL DEFAULT 'user'")
    add_column_if_missing(cur, "users", "avatar_data", "TEXT")
    add_column_if_missing(cur, "conversations", "archived", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(cur, "conversations", "pinned", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(cur, "messages", "pinned", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(cur, "messages", "image_data", "TEXT")
    add_column_if_missing(cur, "sessions", "expires_at", "TEXT")

    # Tables added over time.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS password_resets (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            actor_user_id TEXT NOT NULL,
            actor_email TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT NOT NULL,
            details TEXT
        )
    """)

    conn.commit()
    conn.close()


@pytest.fixture
def test_db(tmp_path):
    database_path = tmp_path / "test_database.db"

    db = Database(str(database_path))
    db.create_table()
    _apply_migrations(db)

    return db