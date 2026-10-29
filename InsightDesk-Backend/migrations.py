"""
One-shot migration script for InsightDesk.

Run once from the project root:

    python migrations.py

Safe to re-run — it checks whether each column exists before adding it.
"""

import sqlite3
import sys
from pathlib import Path


DB_PATH = "Database.db"


def column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def add_column_if_missing(cursor, table: str, column: str, definition: str) -> bool:
    """Returns True if the column was added, False if it already existed."""
    if column_exists(cursor, table, column):
        return False
    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    return True


def main():
    if not Path(DB_PATH).exists():
        print(f"[!] Database file not found: {DB_PATH}")
        print("    Start the app once to create it, then run this script again.")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    changes = []

    # ----- users.role -----
    # 'user'   → normal account
    # 'admin'  → admin panel access
    # 'banned' → cannot log in
    if add_column_if_missing(cur, "users", "role", "TEXT NOT NULL DEFAULT 'user'"):
        changes.append("users.role added (default 'user')")

    # ----- conversations.archived -----
    # 0 = active, 1 = archived (read-only)
    if add_column_if_missing(
        cur, "conversations", "archived", "INTEGER NOT NULL DEFAULT 0"
    ):
        changes.append("conversations.archived added (default 0)")
        
    # ----- conversations.pinned -----
    # 0 = normal, 1 = pinned to top of sidebar
    if add_column_if_missing(
        cur, "conversations", "pinned", "INTEGER NOT NULL DEFAULT 0"
    ):
        changes.append("conversations.pinned added (default 0)")
        
    # ----- messages.pinned -----
    if add_column_if_missing(
        cur, "messages", "pinned", "INTEGER NOT NULL DEFAULT 0"
    ):
        changes.append("messages.pinned added (default 0)")
        
    # ----- messages.image_data -----
    if add_column_if_missing(
        cur, "messages", "image_data", "TEXT"
    ):
        changes.append("messages.image_data added")
        
    # ----- users.avatar_data -----
    if add_column_if_missing(
        cur, "users", "avatar_data", "TEXT"
    ):
        changes.append("users.avatar_data added")
        
    # ----- password_resets table -----
    cur.execute("""
        CREATE TABLE IF NOT EXISTS password_resets (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id)
                REFERENCES users(user_id)
                ON DELETE CASCADE
        )
    """)
    changes.append("password_resets table ensured")
    
    # ----- sessions.expires_at -----
    if add_column_if_missing(
        cur, "sessions", "expires_at", "TEXT"
    ):
        changes.append("sessions.expires_at added")
        
    # ----- audit_log table -----
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
    changes.append("audit_log table ensured")

    conn.commit()
    conn.close()
    


    if changes:
        print("[+] Migration complete. Changes made:")
        for change in changes:
            print(f"    - {change}")
    else:
        print("[=] No changes needed — database is already up to date.")


if __name__ == "__main__":
    main()
    
    