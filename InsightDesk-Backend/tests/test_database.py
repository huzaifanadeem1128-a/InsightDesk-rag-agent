"""
Tests for the Database layer.

Uses the `test_db` fixture from conftest.py, which provides an
isolated temp-file database with the current schema applied.
"""

from datetime import datetime, timezone, timedelta


# ============================================================
# CONVERSATIONS
# ============================================================

def test_create_conversation(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test Chat")

    rows = test_db.get_conversations("user_1")
    assert len(rows) == 1

    chat_id, name, created_at, archived, pinned = rows[0]
    assert chat_id == "chat_1"
    assert name == "Test Chat"
    assert archived == 0
    assert pinned == 0


def test_get_conversations_filters_by_user(test_db):
    test_db.create_conversation("chat_a", "user_a", "A's chat")
    test_db.create_conversation("chat_b", "user_b", "B's chat")

    user_a_chats = test_db.get_conversations("user_a")
    assert len(user_a_chats) == 1
    assert user_a_chats[0][0] == "chat_a"


def test_conversations_ordered_pinned_first(test_db):
    test_db.create_conversation("chat_1", "user_1", "First")
    test_db.create_conversation("chat_2", "user_1", "Second")

    # Pin the older one.
    test_db.toggle_chat_pin("chat_1")

    rows = test_db.get_conversations("user_1")
    # Pinned chat should come first.
    assert rows[0][0] == "chat_1"


def test_rename_conversation(test_db):
    test_db.create_conversation("chat_1", "user_1", "Old Name")
    test_db.rename_conversation("chat_1", "New Name")

    rows = test_db.get_conversations("user_1")
    assert rows[0][1] == "New Name"


def test_delete_conversation_cascades_messages(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")

    test_db.add_message("chat_1", "user", "hello")
    test_db.add_message("chat_1", "assistant", "hi")

    assert len(test_db.get_messages("chat_1")) == 2

    test_db.delete_conversation("chat_1")

    # Messages should be gone (ON DELETE CASCADE).
    assert test_db.get_messages("chat_1") == []
    assert test_db.get_conversations("user_1") == []


def test_toggle_chat_pin(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")

    state = test_db.toggle_chat_pin("chat_1")
    assert state is True

    rows = test_db.get_conversations("user_1")
    assert rows[0][4] == 1  # pinned column

    state = test_db.toggle_chat_pin("chat_1")
    assert state is False

    rows = test_db.get_conversations("user_1")
    assert rows[0][4] == 0


# ============================================================
# MESSAGES
# ============================================================

def test_add_and_get_message(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")

    msg_id = test_db.add_message("chat_1", "user", "hello world")
    assert isinstance(msg_id, int)

    messages = test_db.get_messages("chat_1")
    assert len(messages) == 1

    # message_id, role, content, sources, activity, created_at, pinned, image_data
    assert messages[0][0] == msg_id
    assert messages[0][1] == "user"
    assert messages[0][2] == "hello world"
    assert messages[0][6] == 0  # pinned
    assert messages[0][7] is None  # image_data


def test_messages_returned_in_order(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")

    test_db.add_message("chat_1", "user", "first")
    test_db.add_message("chat_1", "assistant", "second")
    test_db.add_message("chat_1", "user", "third")

    messages = test_db.get_messages("chat_1")
    assert [m[2] for m in messages] == ["first", "second", "third"]


def test_add_message_with_sources(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")

    sources = [{"source": "doc.pdf", "page": 3}]
    test_db.add_message("chat_1", "assistant", "answer", sources=sources)

    messages = test_db.get_messages("chat_1")
    assert messages[0][3] is not None  # sources JSON stored


def test_toggle_pin_message(test_db):
    test_db.create_conversation("chat_1", "user_1", "Test")
    msg_id = test_db.add_message("chat_1", "assistant", "answer")

    state = test_db.toggle_pin_message(msg_id)
    assert state is True

    messages = test_db.get_messages("chat_1")
    assert messages[0][6] == 1

    state = test_db.toggle_pin_message(msg_id)
    assert state is False


# ============================================================
# USERS
# ============================================================

def test_create_and_get_user_by_email(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="hashed",
        security_question="",
        security_answer_hash="",
    )

    row = test_db.get_user_by_email("a@example.com")
    assert row is not None
    assert row[0] == "user_1"
    assert row[1] == "a@example.com"
    assert row[2] == "hashed"


def test_get_user_by_email_returns_none_when_not_found(test_db):
    row = test_db.get_user_by_email("missing@example.com")
    assert row is None


def test_get_user_by_id(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="hashed",
        security_question="",
        security_answer_hash="",
    )

    row = test_db.get_user_by_id("user_1")
    assert row is not None
    assert row[0] == "user_1"


def test_update_password(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="old_hash",
        security_question="",
        security_answer_hash="",
    )

    test_db.update_password("user_1", "new_hash")

    row = test_db.get_user_by_id("user_1")
    assert row[2] == "new_hash"


def test_set_user_role(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )

    test_db.set_user_role("user_1", "admin")
    row = test_db.get_user_by_id("user_1")
    # role is at index 6
    assert row[6] == "admin"


def test_update_user_email(test_db):
    test_db.create_user(
        user_id="user_1",
        email="old@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )

    test_db.update_user_email("user_1", "new@example.com")
    row = test_db.get_user_by_id("user_1")
    assert row[1] == "new@example.com"


# ============================================================
# SESSIONS
# ============================================================

def test_create_and_get_session(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )

    test_db.create_session("token_abc", "user_1")

    row = test_db.get_session("token_abc")
    assert row is not None
    assert row[0] == "token_abc"
    assert row[1] == "user_1"
    # expires_at should be set
    assert row[3] is not None


def test_get_session_returns_none_when_not_found(test_db):
    row = test_db.get_session("nonexistent")
    assert row is None


def test_delete_session(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )
    test_db.create_session("token_abc", "user_1")

    test_db.delete_session("token_abc")
    assert test_db.get_session("token_abc") is None


def test_refresh_session_extends_expiry(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )
    test_db.create_session("token_abc", "user_1")

    row_before = test_db.get_session("token_abc")
    expiry_before = row_before[3]

    test_db.refresh_session("token_abc")

    row_after = test_db.get_session("token_abc")
    expiry_after = row_after[3]

    # Refresh should set a new expiry (likely later than original).
    assert expiry_after is not None


def test_delete_expired_sessions(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )

    # Create a session, then force its expiry into the past.
    test_db.create_session("old_token", "user_1")

    conn = test_db.connect()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    conn.execute(
        "UPDATE sessions SET expires_at = ? WHERE token = ?",
        (past, "old_token")
    )
    conn.commit()
    conn.close()

    # Also add a fresh one.
    test_db.create_session("fresh_token", "user_1")

    deleted = test_db.delete_expired_sessions()
    assert deleted == 1

    assert test_db.get_session("old_token") is None
    assert test_db.get_session("fresh_token") is not None


# ============================================================
# DOCUMENTS
# ============================================================

def test_add_and_get_document(test_db):
    test_db.add_document(
        document_id="doc_1",
        user_id="user_1",
        name="test.pdf",
        collection_name="coll_1",
        content_hash="hash_1",
        chunk_size=800,
        chunk_overlap=150,
        top_k=4,
    )

    rows = test_db.get_documents("user_1")
    assert len(rows) == 1
    assert rows[0][0] == "doc_1"
    assert rows[0][1] == "test.pdf"


def test_get_document_by_hash(test_db):
    test_db.add_document(
        document_id="doc_1",
        user_id="user_1",
        name="test.pdf",
        collection_name="coll_1",
        content_hash="unique_hash",
        chunk_size=800,
        chunk_overlap=150,
        top_k=4,
    )

    row = test_db.get_document_by_hash("unique_hash", "user_1")
    assert row is not None
    assert row[0] == "doc_1"

    missing = test_db.get_document_by_hash("nonexistent", "user_1")
    assert missing is None


# ============================================================
# AUDIT LOG
# ============================================================

def test_log_and_get_audit(test_db):
    test_db.log_audit(
        actor_user_id="admin_1",
        actor_email="admin@example.com",
        action="ban",
        target="bad@example.com",
    )

    entries = test_db.get_audit_log(limit=10)
    assert len(entries) == 1
    assert entries[0]["actor_email"] == "admin@example.com"
    assert entries[0]["action"] == "ban"
    assert entries[0]["target"] == "bad@example.com"


def test_audit_log_limit(test_db):
    for i in range(5):
        test_db.log_audit(
            actor_user_id="admin_1",
            actor_email="admin@example.com",
            action="promote",
            target=f"user_{i}@example.com",
        )

    entries = test_db.get_audit_log(limit=3)
    assert len(entries) == 3


# ============================================================
# DASHBOARD STATS
# ============================================================

def test_get_user_dashboard_stats(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )
    test_db.create_conversation("chat_1", "user_1", "Test")
    test_db.add_message("chat_1", "user", "hello")
    test_db.add_message("chat_1", "assistant", "hi")

    stats = test_db.get_user_dashboard_stats("user_1")
    assert stats["total_chats"] == 1
    assert stats["total_messages"] == 2
    assert stats["total_questions"] == 1
    assert stats["total_documents"] == 0


def test_get_user_usage_stats(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )
    test_db.create_conversation("chat_1", "user_1", "Test")
    test_db.add_message("chat_1", "user", "hello world")
    test_db.add_message("chat_1", "assistant", "answer here")

    usage = test_db.get_user_usage_stats("user_1")
    assert usage["messages_7d"] == 2
    assert usage["questions_7d"] == 1
    assert usage["estimated_tokens_total"] > 0


# ============================================================
# PASSWORD RESETS
# ============================================================

def test_password_reset_lifecycle(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )

    expires = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    test_db.create_password_reset("token_xyz", "user_1", expires)

    row = test_db.get_password_reset("token_xyz")
    assert row is not None
    assert row[0] == "token_xyz"
    assert row[1] == "user_1"
    assert row[4] == 0  # used = 0

    test_db.mark_password_reset_used("token_xyz")
    row = test_db.get_password_reset("token_xyz")
    assert row[4] == 1


# ============================================================
# USER DELETION
# ============================================================

def test_delete_user_and_data(test_db):
    test_db.create_user(
        user_id="user_1",
        email="a@example.com",
        password_hash="x",
        security_question="",
        security_answer_hash="",
    )
    test_db.create_conversation("chat_1", "user_1", "Test")
    test_db.add_message("chat_1", "user", "hello")
    test_db.create_session("token_abc", "user_1")

    counts = test_db.delete_user_and_data("user_1")

    assert counts["users"] == 1
    assert counts["conversations"] == 1
    assert counts["messages"] == 1
    assert counts["sessions"] == 1

    assert test_db.get_user_by_id("user_1") is None
    assert test_db.get_conversations("user_1") == []
    assert test_db.get_session("token_abc") is None