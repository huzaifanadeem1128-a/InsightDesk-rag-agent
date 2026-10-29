"""
Admin endpoints for InsightDesk.

All routes require an admin-role user (enforced by `require_admin`).
"""
import json

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends, Query

from database import Database
from routes.auth import require_admin

from rag_engine import get_embedding_model

router = APIRouter(tags=["Admin"])

db = Database()


# --------------------------------------------------
# HELPERS
# --------------------------------------------------

def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _count(conn, sql: str, params: tuple = ()) -> int:
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


def _build_activity(conn, range_key: str) -> list[dict]:
    """
    Return activity buckets for the requested range.

    range_key: "today" | "week" | "month"
    """

    now = datetime.now(timezone.utc)
    today = now.date()

    if range_key == "today":
        # Hourly buckets for the last 24 hours.
        # SQLite created_at is ISO: "YYYY-MM-DDTHH:MM:SS.ffffff+00:00"
        # We bucket on substr(created_at, 1, 13) → "YYYY-MM-DDTHH"
        since = (now - timedelta(hours=24)).isoformat()

        signup_rows = conn.execute(
            "SELECT substr(created_at, 1, 13) AS b, COUNT(*) "
            "FROM users WHERE created_at >= ? GROUP BY b",
            (since,)
        ).fetchall()
        message_rows = conn.execute(
            "SELECT substr(created_at, 1, 13) AS b, COUNT(*) "
            "FROM messages WHERE created_at >= ? GROUP BY b",
            (since,)
        ).fetchall()

        signups = {r[0]: r[1] for r in signup_rows}
        messages = {r[0]: r[1] for r in message_rows}

        out = []
        for i in range(23, -1, -1):
            t = now - timedelta(hours=i)
            key = t.strftime("%Y-%m-%dT%H")
            out.append({
                "label": t.strftime("%H:00"),
                "signups": signups.get(key, 0),
                "messages": messages.get(key, 0),
            })
        return out

    if range_key == "week":
        days = [(today - timedelta(days=i)) for i in range(6, -1, -1)]
        since = _iso_days_ago(7)
    else:  # month
        days = [(today - timedelta(days=i)) for i in range(29, -1, -1)]
        since = _iso_days_ago(30)

    signup_rows = conn.execute(
        "SELECT substr(created_at, 1, 10) AS d, COUNT(*) "
        "FROM users WHERE created_at >= ? GROUP BY d",
        (since,)
    ).fetchall()
    message_rows = conn.execute(
        "SELECT substr(created_at, 1, 10) AS d, COUNT(*) "
        "FROM messages WHERE created_at >= ? GROUP BY d",
        (since,)
    ).fetchall()

    signups = {r[0]: r[1] for r in signup_rows}
    messages = {r[0]: r[1] for r in message_rows}

    out = []
    for d in days:
        key = d.isoformat()
        out.append({
            "label": d.strftime("%b %d"),
            "signups": signups.get(key, 0),
            "messages": messages.get(key, 0),
        })
    return out

def _count_chunks_per_user(conn) -> dict:
    """
    Return {user_id: chunk_count} for all users with documents.
    Queries each user's Chroma collections once.
    """

    result: dict[str, int] = {}

    doc_rows = conn.execute(
        "SELECT document_id, user_id, collection_name FROM documents"
    ).fetchall()

    if not doc_rows:
        return result

    try:
        from langchain_chroma import Chroma

        embedding = get_embedding_model()

        for doc_id, user_id, collection_name in doc_rows:
            try:
                store = Chroma(
                    collection_name=collection_name,
                    embedding_function=embedding,
                    persist_directory="./chroma_db",
                )
                count = store._collection.count()
                result[user_id] = result.get(user_id, 0) + count
            except Exception:
                # Skip collections that fail to load.
                continue

    except Exception:
        pass

    return result


def _build_fallback_trend(conn, days: int = 30) -> list[dict]:
    """
    Return a per-day fallback rate (%) for the last N days.
    fallback = assistant messages containing "couldn't find that information"
    """

    since = _iso_days_ago(days)

    # Total assistant messages per day
    total_rows = conn.execute(
        """
        SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
        FROM messages
        WHERE role = 'assistant' AND created_at >= ?
        GROUP BY d
        """,
        (since,)
    ).fetchall()

    # Fallback assistant messages per day
    fallback_rows = conn.execute(
        """
        SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c
        FROM messages
        WHERE role = 'assistant'
          AND created_at >= ?
          AND content LIKE '%couldn''t find that information%'
        GROUP BY d
        """,
        (since,)
    ).fetchall()

    totals = {r[0]: r[1] for r in total_rows}
    fallbacks = {r[0]: r[1] for r in fallback_rows}

    today = datetime.now(timezone.utc).date()
    out = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        key = d.isoformat()
        total = totals.get(key, 0)
        fallback = fallbacks.get(key, 0)
        rate = round(100 * fallback / total, 1) if total else 0.0
        out.append({
            "label": d.strftime("%b %d"),
            "rate": rate,
            "total": total,
            "fallback": fallback,
        })
    return out

# --------------------------------------------------
# OVERVIEW
# --------------------------------------------------

@router.get("/admin/overview")
def admin_overview(
    range: str = Query("month", pattern="^(today|week|month)$"),
    user=Depends(require_admin),
):

    conn = db.connect()
    try:
        total_users = _count(conn, "SELECT COUNT(*) FROM users")
        new_users_7d = _count(
            conn,
            "SELECT COUNT(*) FROM users WHERE created_at >= ?",
            (_iso_days_ago(7),)
        )
        total_conversations = _count(conn, "SELECT COUNT(*) FROM conversations")
        total_messages = _count(conn, "SELECT COUNT(*) FROM messages")
        active_sessions = _count(conn, "SELECT COUNT(*) FROM sessions")
        total_documents = _count(conn, "SELECT COUNT(*) FROM documents")

        total_assistant = _count(
            conn,
            "SELECT COUNT(*) FROM messages WHERE role = 'assistant'"
        )
        total_fallback = _count(
            conn,
            "SELECT COUNT(*) FROM messages "
            "WHERE role = 'assistant' "
            "AND content LIKE '%couldn''t find that information%'"
        )
        fallback_rate = (
            f"{round(100 * total_fallback / total_assistant, 1)}%"
            if total_assistant else "0%"
        )

        # ----- RAG HEALTH METRICS -----

        total_chunks = 0
        avg_chunks_per_doc = 0.0
        try:
            chunk_map = _count_chunks_per_user(conn)
            total_chunks = sum(chunk_map.values())
            if total_documents > 0:
                avg_chunks_per_doc = round(total_chunks / total_documents, 1)
        except Exception:
            pass

        avg_messages_per_chat = (
            round(total_messages / total_conversations, 2)
            if total_conversations else 0.0
        )

        # Memory entries — count memories across all users.
        # We approximate by counting user-role messages (each is a memory).
        memory_entries = _count(
            conn,
            "SELECT COUNT(*) FROM messages WHERE role = 'user'"
        )

        fallback_trend = _build_fallback_trend(conn, days=30)

        health = {
            "total_chunks": total_chunks,
            "avg_chunks_per_doc": avg_chunks_per_doc,
            "avg_messages_per_chat": avg_messages_per_chat,
            "memory_entries": memory_entries,
            "fallback_trend": fallback_trend,
        }

        activity = _build_activity(conn, range)

        # Users list
        user_rows = conn.execute(
            """
            SELECT
                u.user_id,
                u.email,
                u.role,
                u.created_at,
                (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.user_id) AS chat_count,
                (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.user_id) AS document_count,
                (SELECT COUNT(*) FROM messages m
                    JOIN conversations c2 ON c2.chat_id = m.chat_id
                    WHERE c2.user_id = u.user_id AND m.role = 'user') AS question_count
            FROM users u
            ORDER BY u.created_at DESC
            """
        ).fetchall()

        users = [
            {
                "user_id": row[0],
                "email": row[1],
                "role": row[2] or "user",
                "created_at": row[3],
                "chat_count": row[4],
                "document_count": row[5],
                "question_count": row[6],
            }
            for row in user_rows
        ]

        # Documents list
        doc_rows = conn.execute(
            """
            SELECT
                d.document_id,
                d.name,
                d.created_at,
                d.user_id,
                u.email
            FROM documents d
            LEFT JOIN users u ON u.user_id = d.user_id
            ORDER BY d.created_at DESC
            """
        ).fetchall()

        documents = [
            {
                "document_id": row[0],
                "name": row[1],
                "created_at": row[2],
                "user_id": row[3],
                "user_email": row[4],
                "chunks": "-",
            }
            for row in doc_rows
        ]

        # Recent questions — last 50 user-role messages
        question_rows = conn.execute(
            """
            SELECT
                m.content,
                m.created_at,
                u.email
            FROM messages m
            JOIN conversations c ON c.chat_id = m.chat_id
            LEFT JOIN users u ON u.user_id = c.user_id
            WHERE m.role = 'user'
            ORDER BY m.created_at DESC
            LIMIT 50
            """
        ).fetchall()

        recent_questions = [
            {
                "content": row[0],
                "created_at": row[1],
                "email": row[2] or "unknown",
            }
            for row in question_rows
        ]

        total_questions = _count(
            conn,
            "SELECT COUNT(*) FROM messages WHERE role = 'user'"
        )
        questions_7d = _count(
            conn,
            "SELECT COUNT(*) FROM messages WHERE role = 'user' AND created_at >= ?",
            (_iso_days_ago(7),)
        )

        # System info
        from rag_engine import EMBEDDING_MODEL, GROQ_MODEL

        system = {
            "llm_model": GROQ_MODEL,
            "embedding_model": EMBEDDING_MODEL,
            "uptime": "-",
            "active_sessions": active_sessions,
        }

        return {
            "range": range,
            "total_users": total_users,
            "new_users_7d": new_users_7d,
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "total_documents": total_documents,
            "total_chunks": total_chunks,
            "fallback_rate": fallback_rate,
            "active_sessions": active_sessions,
            "activity": activity,
            "users": users,
            "documents": documents,
            "recent_questions": recent_questions,
            "total_questions": total_questions,
            "questions_7d": questions_7d,
            "system": system,
            "health": health,
        }

    finally:
        conn.close()


# --------------------------------------------------
# USER ACTIONS
# --------------------------------------------------

VALID_ACTIONS = {
    "promote": "admin",
    "demote": "user",
    "ban": "banned",
    "unban": "user",
}


@router.post("/admin/users/{user_id}/{action}")
def admin_user_action(
    user_id: str,
    action: str,
    admin=Depends(require_admin),
):

    if action not in VALID_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown action: {action}. Valid: {list(VALID_ACTIONS)}"
        )

    admin_user_id = admin[0]
    if user_id == admin_user_id and action in ("ban", "demote"):
        raise HTTPException(
            status_code=400,
            detail="You cannot ban or demote yourself."
        )

    target = db.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    target_role = target[6] if len(target) > 6 else "user"

    # Guard: cannot ban another admin directly.
    # (Demoting is fine — that's how you remove admin privileges.)
    if action == "ban" and target_role == "admin":
        raise HTTPException(
            status_code=400,
            detail="Cannot ban an admin. Demote them first."
        )

    # Guard: cannot promote a banned user (must unban first).
    if action == "promote" and target_role == "banned":
        raise HTTPException(
            status_code=400,
            detail="Unban this user before promoting them."
        )

    # Guard: cannot unban a non-banned user, or demote a non-admin, etc.
    if action == "unban" and target_role != "banned":
        raise HTTPException(
            status_code=400,
            detail="This user is not banned."
        )

    if action == "promote" and target_role == "admin":
        raise HTTPException(
            status_code=400,
            detail="This user is already an admin."
        )

    new_role = VALID_ACTIONS[action]
    db.set_user_role(user_id, new_role)

    if new_role == "banned":
        conn = db.connect()
        try:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    # Audit log.
    admin_email = admin[1] if len(admin) > 1 else "unknown"
    target_email = target[1] if len(target) > 1 else user_id
    db.log_audit(
        actor_user_id=admin_user_id,
        actor_email=admin_email,
        action=action,
        target=target_email,
    )

    return {
        "message": f"User {action} successful.",
        "user_id": user_id,
        "role": new_role,
    }
    
# --------------------------------------------------
# AUDIT LOG
# --------------------------------------------------

@router.get("/admin/audit")
def admin_audit(
    limit: int = Query(100, ge=1, le=500),
    admin=Depends(require_admin),
):
    """Return the most recent audit entries."""

    entries = db.get_audit_log(limit=limit)
    return {"entries": entries}
    
# --------------------------------------------------
# USER DETAIL
# --------------------------------------------------

@router.get("/admin/users/{user_id}")
def admin_user_detail(
    user_id: str,
    admin=Depends(require_admin),
):
    """
    Return a full breakdown of a single user: profile, stats,
    all chats with their messages, and all documents.
    """

    target = db.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    (
        _uid,
        email,
        _password_hash,
        _sq,
        _sah,
        created_at,
        role,
        *_rest,
    ) = target

    conn = db.connect()
    try:
        # ---- Stats ----
        total_chats = _count(
            conn,
            "SELECT COUNT(*) FROM conversations WHERE user_id = ?",
            (user_id,)
        )
        total_messages = _count(
            conn,
            """
            SELECT COUNT(*)
            FROM messages
            WHERE chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
            )
            """,
            (user_id,)
        )
        total_questions = _count(
            conn,
            """
            SELECT COUNT(*)
            FROM messages
            WHERE role = 'user'
              AND chat_id IN (
                SELECT chat_id FROM conversations WHERE user_id = ?
              )
            """,
            (user_id,)
        )
        total_documents = _count(
            conn,
            "SELECT COUNT(*) FROM documents WHERE user_id = ?",
            (user_id,)
        )

        # ---- Chats with messages ----
        chat_rows = conn.execute(
            """
            SELECT chat_id, name, created_at, archived, pinned
            FROM conversations
            WHERE user_id = ?
            ORDER BY pinned DESC, created_at DESC
            """,
            (user_id,)
        ).fetchall()

        chats = []
        for chat_id, name, chat_created, archived, pinned in chat_rows:
            msg_rows = conn.execute(
                """
                SELECT message_id, role, content, sources, activity,
                       created_at, pinned, image_data
                FROM messages
                WHERE chat_id = ?
                ORDER BY message_id
                """,
                (chat_id,)
            ).fetchall()

            messages = []
            for m in msg_rows:
                (
                    message_id,
                    msg_role,
                    content,
                    sources_json,
                    activity_json,
                    msg_created,
                    msg_pinned,
                    image_data,
                ) = m

                entry = {
                    "message_id": message_id,
                    "role": msg_role,
                    "content": content,
                    "created_at": msg_created,
                    "pinned": bool(msg_pinned),
                }

                if sources_json:
                    try:
                        entry["sources"] = __import__("json").loads(sources_json)
                    except Exception:
                        entry["sources"] = []
                else:
                    entry["sources"] = []

                if image_data:
                    entry["has_image"] = True

                messages.append(entry)

            chats.append({
                "chat_id": chat_id,
                "name": name,
                "created_at": chat_created,
                "archived": bool(archived),
                "pinned": bool(pinned),
                "message_count": len(messages),
                "messages": messages,
            })

        # ---- Documents ----
        doc_rows = conn.execute(
            """
            SELECT document_id, name, created_at, collection_name
            FROM documents
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,)
        ).fetchall()

        # Chunk counts per document
        chunk_map: dict[str, int] = {}
        try:
            from langchain_chroma import Chroma
            embedding = get_embedding_model()
            for doc_id, _name, _created, collection_name in doc_rows:
                try:
                    store = Chroma(
                        collection_name=collection_name,
                        embedding_function=embedding,
                        persist_directory="./chroma_db",
                    )
                    chunk_map[doc_id] = store._collection.count()
                except Exception:
                    chunk_map[doc_id] = 0
        except Exception:
            pass

        documents = [
            {
                "document_id": row[0],
                "name": row[1],
                "created_at": row[2],
                "chunks": chunk_map.get(row[0], 0),
            }
            for row in doc_rows
        ]

        return {
            "user_id": user_id,
            "email": email,
            "role": role,
            "created_at": created_at,
            "stats": {
                "total_chats": total_chats,
                "total_messages": total_messages,
                "total_questions": total_questions,
                "total_documents": total_documents,
            },
            "chats": chats,
            "documents": documents,
        }

    finally:
        conn.close()