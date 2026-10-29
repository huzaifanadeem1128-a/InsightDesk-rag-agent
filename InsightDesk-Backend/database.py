import json
import sqlite3
from datetime import datetime, timezone, timedelta


class Database:

    def __init__(self, database_name="Database.db"):
        self.database_name = database_name

    def connect(self):
        connection = sqlite3.connect(self.database_name)
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def create_table(self):

        connection = self.connect()

        connection.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                chat_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sources TEXT,
                activity TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id)
                    REFERENCES conversations(chat_id)
                    ON DELETE CASCADE
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                document_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                collection_name TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                chunk_size INTEGER NOT NULL,
                chunk_overlap INTEGER NOT NULL,
                top_k INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                security_question TEXT NOT NULL,
                security_answer_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id)
                    REFERENCES users(user_id)
                    ON DELETE CASCADE
            )
        """)

        connection.commit()
        connection.close()

    def create_conversation(self, chat_id, user_id, name):

        connection = self.connect()

        created_at = datetime.now(
            timezone.utc
        ).isoformat()

        connection.execute(
            """
            INSERT INTO conversations
            (chat_id, user_id, name, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (chat_id, user_id, name, created_at)
        )

        connection.commit()
        connection.close()

    def add_message(
        self,
        chat_id,
        role,
        content,
        sources=None,
        activity=None,
        image_data=None,
    ):

        connection = self.connect()

        created_at = datetime.now(
            timezone.utc
        ).isoformat()

        sources_json = json.dumps(
            sources or [],
            ensure_ascii=False
        )

        activity_json = json.dumps(
            activity or [],
            ensure_ascii=False
        )

        cursor = connection.execute(
            """
            INSERT INTO messages
            (
                chat_id,
                role,
                content,
                sources,
                activity,
                created_at,
                image_data
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                chat_id,
                role,
                content,
                sources_json,
                activity_json,
                created_at,
                image_data,
            )
        )

        new_id = cursor.lastrowid
        connection.commit()
        connection.close()

        return new_id

    def get_conversations(self, user_id):

        connection = self.connect()

        rows = connection.execute(
            """
            SELECT chat_id, name, created_at, archived, pinned
            FROM conversations
            WHERE user_id = ?
            ORDER BY pinned DESC, created_at DESC
            """,
            (user_id,)
        ).fetchall()

        connection.close()

        return rows
    
    def get_user_dashboard_stats(self, user_id):
        """
        Return aggregate counts for a user:
          - total_chats
          - total_messages
          - total_documents
          - total_questions (messages with role='user')
        """

        connection = self.connect()

        total_chats = connection.execute(
            "SELECT COUNT(*) FROM conversations WHERE user_id = ?",
            (user_id,)
        ).fetchone()[0]

        total_messages = connection.execute(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
            )
            """,
            (user_id,)
        ).fetchone()[0]

        total_questions = connection.execute(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE role = 'user'
              AND chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
              )
            """,
            (user_id,)
        ).fetchone()[0]

        total_documents = connection.execute(
            "SELECT COUNT(*) FROM documents WHERE user_id = ?",
            (user_id,)
        ).fetchone()[0]

        connection.close()

        return {
            "total_chats": total_chats,
            "total_messages": total_messages,
            "total_questions": total_questions,
            "total_documents": total_documents,
        }
        
    def get_user_usage_stats(self, user_id):
        """
        Return message counts and estimated token usage.
        Estimated tokens = sum(len(content)) / 4 across all messages.
        """

        connection = self.connect()

        # Message count in the last 7 days.
        week_ago_iso = (
            datetime.now(timezone.utc) - timedelta(days=7)
        ).isoformat()

        week_messages = connection.execute(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
            )
              AND created_at >= ?
            """,
            (user_id, week_ago_iso)
        ).fetchone()[0]

        # Total character count of all messages, used for token estimate.
        total_chars = connection.execute(
            """
            SELECT COALESCE(SUM(LENGTH(content)), 0)
            FROM messages
            WHERE chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
            )
            """,
            (user_id,)
        ).fetchone()[0]

        # User messages only (questions asked).
        week_questions = connection.execute(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE role = 'user'
              AND chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
              )
              AND created_at >= ?
            """,
            (user_id, week_ago_iso)
        ).fetchone()[0]

        connection.close()

        return {
            "messages_7d": week_messages,
            "questions_7d": week_questions,
            "estimated_tokens_total": total_chars // 4,
        }
        
    def log_audit(self, actor_user_id, actor_email, action, target, details=None):
        """Record an admin action."""

        connection = self.connect()
        created_at = datetime.now(timezone.utc).isoformat()

        connection.execute(
            """
            INSERT INTO audit_log
            (created_at, actor_user_id, actor_email, action, target, details)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (created_at, actor_user_id, actor_email, action, target, details)
        )

        connection.commit()
        connection.close()

    def get_audit_log(self, limit=100):
        """Return the most recent audit entries."""

        connection = self.connect()

        rows = connection.execute(
            """
            SELECT id, created_at, actor_email, action, target, details
            FROM audit_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()

        connection.close()

        return [
            {
                "id": row[0],
                "created_at": row[1],
                "actor_email": row[2],
                "action": row[3],
                "target": row[4],
                "details": row[5],
            }
            for row in rows
        ]

    def get_messages(self, chat_id):

        connection = self.connect()

        rows = connection.execute(
            """
            SELECT
                message_id,
                role,
                content,
                sources,
                activity,
                created_at,
                pinned,
                image_data
            FROM messages
            WHERE chat_id = ?
            ORDER BY message_id
            """,
            (chat_id,)
        ).fetchall()

        connection.close()

        return rows

    def toggle_pin_message(self, message_id):
        """Flip the pinned flag on a message. Returns the new state."""

        connection = self.connect()

        row = connection.execute(
            "SELECT pinned FROM messages WHERE message_id = ?",
            (message_id,)
        ).fetchone()

        if row is None:
            connection.close()
            raise ValueError("Message not found")

        new_state = 0 if row[0] else 1

        connection.execute(
            "UPDATE messages SET pinned = ? WHERE message_id = ?",
            (new_state, message_id)
        )

        connection.commit()
        connection.close()

        return bool(new_state)

    def rename_conversation(
        self,
        chat_id,
        new_name
    ):

        connection = self.connect()

        connection.execute(
            """
            UPDATE conversations
            SET name = ?
            WHERE chat_id = ?
            """,
            (new_name, chat_id)
        )

        connection.commit()
        connection.close()
        
    def toggle_chat_pin(self, chat_id):
        """Flip the pinned flag on a conversation. Returns the new state."""

        connection = self.connect()

        row = connection.execute(
            "SELECT pinned FROM conversations WHERE chat_id = ?",
            (chat_id,)
        ).fetchone()

        if row is None:
            connection.close()
            raise ValueError("Chat not found")

        new_state = 0 if row[0] else 1

        connection.execute(
            "UPDATE conversations SET pinned = ? WHERE chat_id = ?",
            (new_state, chat_id)
        )

        connection.commit()
        connection.close()

        return bool(new_state)
        
    def update_conversation_name(self, chat_id, new_name):
        """Update conversation name. Silent no-op if chat doesn't exist."""

        connection = self.connect()

        connection.execute(
            """
            UPDATE conversations
            SET name = ?
            WHERE chat_id = ?
            """,
            (new_name, chat_id)
        )

        connection.commit()
        connection.close()

    def delete_conversation(
        self,
        chat_id
    ):

        connection = self.connect()

        connection.execute(
            """
            DELETE FROM conversations
            WHERE chat_id = ?
            """,
            (chat_id,)
        )

        connection.commit()
        connection.close()

    def add_document(
        self,
        document_id,
        user_id,
        name,
        content_hash,
        collection_name,
        chunk_size,
        chunk_overlap,
        top_k
    ):

        connection = self.connect()

        created_at = datetime.now(
            timezone.utc
        ).isoformat()

        connection.execute(
            """
            INSERT INTO documents
            (
                document_id,
                user_id,
                name,
                collection_name,
                content_hash,
                chunk_size,
                chunk_overlap,
                top_k,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                user_id,
                name,
                collection_name,
                content_hash,
                chunk_size,
                chunk_overlap,
                top_k,
                created_at
            )
        )

        connection.commit()
        connection.close()

    def get_documents(self, user_id):

        connection = self.connect()

        rows = connection.execute(
            """
            SELECT
                document_id,
                name,
                collection_name,
                content_hash,
                chunk_size,
                chunk_overlap,
                top_k,
                created_at
            FROM documents
            WHERE user_id = ?
            ORDER BY created_at
            """,
            (user_id,)
        ).fetchall()

        connection.close()

        return rows

    def get_document_by_hash(self, content_hash, user_id):

        connection = self.connect()

        row = connection.execute(
            """
            SELECT
                document_id,
                name,
                collection_name,
                content_hash,
                chunk_size,
                chunk_overlap,
                top_k,
                created_at
            FROM documents
            WHERE content_hash = ? AND user_id = ?
            """,
            (content_hash, user_id)
        ).fetchone()

        connection.close()

        return row

    def delete_document(
        self,
        document_id
    ):

        connection = self.connect()

        connection.execute(
            """
            DELETE FROM documents
            WHERE document_id = ?
            """,
            (document_id,)
        )

        connection.commit()
        connection.close()
        
    def get_chats_using_document(self, document_id):
        """
        Return chats that reference this document.

        A chat is considered to "use" a document if any message in it
        has 'sources' JSON containing this document_id. We search the
        raw JSON text with LIKE — good enough at current scale.
        """

        connection = self.connect()

        rows = connection.execute(
            """
            SELECT DISTINCT
                c.chat_id,
                c.name,
                c.user_id,
                c.archived
            FROM conversations c
            JOIN messages m ON m.chat_id = c.chat_id
            WHERE m.sources LIKE ?
            ORDER BY c.created_at DESC
            """,
            (f'%"{document_id}"%',)
        ).fetchall()

        connection.close()

        return rows
    
    def archive_conversation(self, chat_id):
        """Mark a conversation as archived (read-only)."""

        connection = self.connect()

        connection.execute(
            """
            UPDATE conversations
            SET archived = 1
            WHERE chat_id = ?
            """,
            (chat_id,)
        )

        connection.commit()
        connection.close()

    def archive_conversations_using_document(self, document_id, user_id=None):
        """
        Archive every non-archived conversation that references this document.

        If user_id is provided, only that user's conversations are affected.
        Returns the number of conversations that were archived.
        """

        connection = self.connect()

        if user_id is None:

            cursor = connection.execute(
                """
                UPDATE conversations
                SET archived = 1
                WHERE archived = 0
                  AND chat_id IN (
                      SELECT DISTINCT m.chat_id
                      FROM messages m
                      WHERE m.sources LIKE ?
                  )
                """,
                (f'%"{document_id}"%',)
            )

        else:

            cursor = connection.execute(
                """
                UPDATE conversations
                SET archived = 1
                WHERE archived = 0
                  AND user_id = ?
                  AND chat_id IN (
                      SELECT DISTINCT m.chat_id
                      FROM messages m
                      WHERE m.sources LIKE ?
                  )
                """,
                (user_id, f'%"{document_id}"%')
            )

        affected = cursor.rowcount
        connection.commit()
        connection.close()

        return affected

    def create_user(
        self,
        user_id,
        email,
        password_hash,
        security_question,
        security_answer_hash
    ):

        connection = self.connect()

        created_at = datetime.now(
            timezone.utc
        ).isoformat()

        connection.execute(
            """
            INSERT INTO users
            (
                user_id,
                email,
                password_hash,
                security_question,
                security_answer_hash,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                email,
                password_hash,
                security_question,
                security_answer_hash,
                created_at
            )
        )

        connection.commit()
        connection.close()

    def get_user_by_email(self, email):

        connection = self.connect()

        row = connection.execute(
            """
            SELECT
                user_id,
                email,
                password_hash,
                security_question,
                security_answer_hash,
                created_at,
                role,
                avatar_data
            FROM users
            WHERE email = ?
            """,
            (email,)
        ).fetchone()

        connection.close()

        return row

    def get_user_by_id(self, user_id):

        connection = self.connect()

        row = connection.execute(
            """
            SELECT
                user_id,
                email,
                password_hash,
                security_question,
                security_answer_hash,
                created_at,
                role,
                avatar_data
            FROM users
            WHERE user_id = ?
            """,
            (user_id,)
        ).fetchone()

        connection.close()

        return row
    
    def set_user_role(self, user_id, role):
        """Set a user's role. Valid values: 'user', 'admin', 'banned'."""

        connection = self.connect()

        connection.execute(
            """
            UPDATE users
            SET role = ?
            WHERE user_id = ?
            """,
            (role, user_id)
        )

        connection.commit()
        connection.close()

    def update_password(self, user_id, new_password_hash):

        connection = self.connect()

        connection.execute(
            """
            UPDATE users
            SET password_hash = ?
            WHERE user_id = ?
            """,
            (new_password_hash, user_id)
        )

        connection.commit()
        connection.close()
        
    def create_password_reset(self, token, user_id, expires_at):
        """Insert a new reset token."""

        connection = self.connect()
        created_at = datetime.now(timezone.utc).isoformat()

        connection.execute(
            """
            INSERT INTO password_resets
            (token, user_id, created_at, expires_at, used)
            VALUES (?, ?, ?, ?, 0)
            """,
            (token, user_id, created_at, expires_at)
        )
        connection.commit()
        connection.close()

    def get_password_reset(self, token):
        """Return (token, user_id, created_at, expires_at, used) or None."""

        connection = self.connect()
        row = connection.execute(
            """
            SELECT token, user_id, created_at, expires_at, used
            FROM password_resets
            WHERE token = ?
            """,
            (token,)
        ).fetchone()
        connection.close()
        return row

    def mark_password_reset_used(self, token):
        """Mark a reset token as used (single-use)."""

        connection = self.connect()
        connection.execute(
            "UPDATE password_resets SET used = 1 WHERE token = ?",
            (token,)
        )
        connection.commit()
        connection.close()

    def delete_user_sessions(self, user_id):
        """Revoke all sessions for a user (used after password reset)."""

        connection = self.connect()
        connection.execute(
            "DELETE FROM sessions WHERE user_id = ?",
            (user_id,)
        )
        connection.commit()
        connection.close()
        
    def update_user_email(self, user_id, new_email):
        """Update a user's email. Assumes caller has verified uniqueness."""

        connection = self.connect()
        connection.execute(
            "UPDATE users SET email = ? WHERE user_id = ?",
            (new_email, user_id)
        )
        connection.commit()
        connection.close()


    def delete_user_and_data(self, user_id):
        """
        Hard-delete a user and everything that belongs to them.
        Order matters due to foreign keys.
        Returns a dict of counts for logging.
        """

        connection = self.connect()

        # Delete messages via subquery (chat_id FK).
        cur = connection.execute(
            """
            DELETE FROM messages
            WHERE chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
            )
            """,
            (user_id,)
        )
        messages_deleted = cur.rowcount

        cur = connection.execute(
            "DELETE FROM conversations WHERE user_id = ?",
            (user_id,)
        )
        conversations_deleted = cur.rowcount

        cur = connection.execute(
            "DELETE FROM documents WHERE user_id = ?",
            (user_id,)
        )
        documents_deleted = cur.rowcount

        cur = connection.execute(
            "DELETE FROM sessions WHERE user_id = ?",
            (user_id,)
        )
        sessions_deleted = cur.rowcount

        cur = connection.execute(
            "DELETE FROM users WHERE user_id = ?",
            (user_id,)
        )
        users_deleted = cur.rowcount

        connection.commit()
        connection.close()

        return {
            "messages": messages_deleted,
            "conversations": conversations_deleted,
            "documents": documents_deleted,
            "sessions": sessions_deleted,
            "users": users_deleted,
        }

    def create_session(self, token, user_id, ttl_days=30):

        connection = self.connect()

        now = datetime.now(timezone.utc)
        created_at = now.isoformat()
        expires_at = (now + timedelta(days=ttl_days)).isoformat()

        connection.execute(
            """
            INSERT INTO sessions
            (token, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token, user_id, created_at, expires_at)
        )

        connection.commit()
        connection.close()

    def get_session(self, token):

        connection = self.connect()

        row = connection.execute(
            """
            SELECT token, user_id, created_at, expires_at
            FROM sessions
            WHERE token = ?
            """,
            (token,)
        ).fetchone()

        connection.close()

        return row

    def refresh_session(self, token, ttl_days=30):
        """Extend a session's expiry. No-op if token not found."""

        connection = self.connect()

        new_expiry = (
            datetime.now(timezone.utc) + timedelta(days=ttl_days)
        ).isoformat()

        connection.execute(
            "UPDATE sessions SET expires_at = ? WHERE token = ?",
            (new_expiry, token)
        )

        connection.commit()
        connection.close()

    def delete_expired_sessions(self):
        """Remove sessions whose expires_at is in the past."""

        connection = self.connect()

        now_iso = datetime.now(timezone.utc).isoformat()

        cursor = connection.execute(
            """
            DELETE FROM sessions
            WHERE expires_at IS NOT NULL AND expires_at < ?
            """,
            (now_iso,)
        )

        count = cursor.rowcount
        connection.commit()
        connection.close()

        return count

    def delete_session(self, token):

        connection = self.connect()

        connection.execute(
            """
            DELETE FROM sessions
            WHERE token = ?
            """,
            (token,)
        )

        connection.commit()
        connection.close()

    def update_message(
        self,
        message_id,
        content,
        sources=None,
        activity=None,
    ):
        """Update content of an existing message. Used by regenerate."""

        if not message_id:
            return

        connection = self.connect()

        sources_json = json.dumps(sources or [], ensure_ascii=False)
        activity_json = json.dumps(activity or [], ensure_ascii=False)

        connection.execute(
            """
            UPDATE messages
            SET content = ?, sources = ?, activity = ?
            WHERE message_id = ?
            """,
            (content, sources_json, activity_json, message_id)
        )

        connection.commit()
        connection.close()

if __name__ == "__main__":

    db = Database()

    db.create_table()

    print("Database and tables created successfully!")
    
