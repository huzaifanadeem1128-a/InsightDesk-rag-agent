"""
Tests for authentication endpoints.

Uses TestClient(app) — hits the real DB. Each test uses a unique
email so tests don't collide. Users created during tests are
left in the DB but with `test_...@example.com` addresses, which
makes them easy to clean up later.
"""

import uuid
import pytest

from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


# --------------------------------------------------
# Rate limit reset — prevents 429s in test runs
# --------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from services.rate_limit import _buckets, _lock
    with _lock:
        _buckets.clear()
    yield
    with _lock:
        _buckets.clear()


def _unique_email() -> str:
    return f"test_{uuid.uuid4().hex}@example.com"


def _signup_and_login() -> dict:
    """Create a fresh user and return auth headers."""
    email = _unique_email()
    password = "test123"

    signup = client.post(
        "/auth/signup",
        json={"email": email, "password": password},
    )
    assert signup.status_code == 200, signup.text

    login = client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text

    token = login.json()["token"]
    return {
        "email": email,
        "password": password,
        "token": token,
        "headers": {"Authorization": f"Bearer {token}"},
    }


# --------------------------------------------------
# SIGNUP
# --------------------------------------------------

def test_signup_creates_account():
    email = _unique_email()

    response = client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "user_id" in body
    assert body["user_id"].startswith("user_")


def test_signup_rejects_short_password():
    email = _unique_email()

    response = client.post(
        "/auth/signup",
        json={"email": email, "password": "123"},
    )

    assert response.status_code == 400
    assert "6" in response.json()["detail"]


def test_signup_rejects_duplicate_email():
    email = _unique_email()

    first = client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )
    assert first.status_code == 200

    second = client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )
    assert second.status_code == 400
    assert "already exists" in second.json()["detail"].lower()


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

def test_login_succeeds_with_correct_credentials():
    email = _unique_email()
    client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )

    response = client.post(
        "/auth/login",
        json={"email": email, "password": "test123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "token" in body
    assert body["email"] == email
    assert body["role"] in ("user", "admin", "banned")


def test_login_fails_with_wrong_password():
    email = _unique_email()
    client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )

    response = client.post(
        "/auth/login",
        json={"email": email, "password": "wrongpass"},
    )

    assert response.status_code == 401


def test_login_fails_for_nonexistent_email():
    response = client.post(
        "/auth/login",
        json={"email": _unique_email(), "password": "test123"},
    )

    assert response.status_code == 401


# --------------------------------------------------
# PROTECTED ROUTES
# --------------------------------------------------

def test_protected_route_requires_token():
    response = client.get("/chats")
    assert response.status_code in (401, 422)


def test_protected_route_rejects_invalid_token():
    response = client.get(
        "/chats",
        headers={"Authorization": "Bearer invalid_token_xyz"},
    )
    assert response.status_code == 401


def test_protected_route_succeeds_with_valid_token():
    session = _signup_and_login()
    response = client.get("/chats", headers=session["headers"])
    assert response.status_code == 200


# --------------------------------------------------
# LOGOUT
# --------------------------------------------------

def test_logout_invalidates_session():
    session = _signup_and_login()

    # Confirm session works.
    ok = client.get("/chats", headers=session["headers"])
    assert ok.status_code == 200

    # Log out.
    logout = client.post("/auth/logout", headers=session["headers"])
    assert logout.status_code == 200

    # Session should be dead.
    after = client.get("/chats", headers=session["headers"])
    assert after.status_code == 401


# --------------------------------------------------
# FORGOT PASSWORD
# --------------------------------------------------

def test_forgot_password_returns_generic_message_for_existing_email():
    email = _unique_email()
    client.post(
        "/auth/signup",
        json={"email": email, "password": "test123"},
    )

    response = client.post(
        "/auth/forgot-password",
        json={"email": email},
    )

    assert response.status_code == 200
    body = response.json()
    assert "message" in body
    # Must not leak whether the email exists.
    assert "security_question" not in body


def test_forgot_password_returns_generic_message_for_nonexistent_email():
    response = client.post(
        "/auth/forgot-password",
        json={"email": _unique_email()},
    )

    assert response.status_code == 200
    body = response.json()
    assert "message" in body


# --------------------------------------------------
# RATE LIMITING
# --------------------------------------------------

def test_rate_limit_blocks_rapid_logins():
    """
    Fire 10 login attempts quickly. After the 7th, we should
    start seeing 429 responses.
    """

    statuses = []
    for _ in range(10):
        r = client.post(
            "/auth/login",
            json={"email": "nobody@example.com", "password": "wrong"},
        )
        statuses.append(r.status_code)

    # First few should be 401 (bad credentials).
    assert 401 in statuses
    # Later ones should be 429 (rate limited).
    assert 429 in statuses