import secrets
import os
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Header, Depends, Request

from database import Database

from services.auth import (
    hash_value,
    verify_value,
    generate_user_id,
    generate_session_token
)

from schemas.auth import (
    SignupRequest,
    LoginRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)

from services import rag_state
from services.email import send_password_reset_email
from services.rate_limit import is_allowed as rate_allowed

router = APIRouter(tags=["Authentication"])

db = Database()
db.create_table()

# Clean up expired sessions on startup.
try:
    db.delete_expired_sessions()
except Exception:
    pass

def normalize_answer(answer: str) -> str:
    return answer.strip().lower()


@router.post("/auth/signup")
def signup(request: SignupRequest, http_request: Request):
    ip = http_request.client.host if http_request.client else "unknown"
    if not rate_allowed(f"signup:{ip}", 7):
        raise HTTPException(
            status_code=429,
            detail="Too many signup attempts. Please try again in a minute."
        )

    email = str(request.email).strip().lower()

    existing_user = db.get_user_by_email(email)

    if existing_user is not None:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists."
        )

    if len(request.password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters long."
        )

    user_id = generate_user_id()
    password_hash = hash_value(request.password)

    # Column compatibility: security_question and security_answer_hash
    # are still NOT NULL in the schema, so we store empty placeholders.
    db.create_user(
        user_id=user_id,
        email=email,
        password_hash=password_hash,
        security_question="",
        security_answer_hash="",
    )

    return {
        "message": "Account created successfully.",
        "user_id": user_id
    }

@router.post("/auth/login")
def login(request: LoginRequest, http_request: Request):
    ip = http_request.client.host if http_request.client else "unknown"
    if not rate_allowed(f"login:{ip}", 7):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a minute."
        )

    email = str(request.email).strip().lower()
    user = db.get_user_by_email(email)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password."
        )

    (
        user_id,
        email,
        password_hash,
        security_question,
        security_answer_hash,
        created_at,
        role,
        _avatar_data,
    ) = user

    if not verify_value(
        request.password,
        password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password."
        )

    if role == "banned":
        raise HTTPException(
            status_code=403,
            detail="Your account has been suspended. Contact an administrator."
        )

    token = generate_session_token()

    db.create_session(
        token=token,
        user_id=user_id
    )

    return {
        "message": "Login successful.",
        "token": token,
        "user_id": user_id,
        "email": email,
        "role": role,
    }


@router.post("/auth/logout")
def logout(authorization: str = Header(...)):

    token = _extract_token(authorization)

    db.delete_session(token)

    return {
        "message": "Logged out successfully."
    }


@router.post("/auth/forgot-password")
def forgot_password(request: ForgotPasswordRequest, http_request: Request):
    ip = http_request.client.host if http_request.client else "unknown"
    if not rate_allowed(f"forgot:{ip}", 7):
        raise HTTPException(
            status_code=429,
            detail="Too many reset requests. Please try again in a minute."
        )

    email = str(request.email).strip().lower()
    user = db.get_user_by_email(email)

    # SECURITY: always return success, whether or not the email exists.
    # This prevents account enumeration.
    generic_response = {
        "message": "If an account exists with that email, a reset link has been sent."
    }

    if user is None:
        return generic_response

    user_id = user[0]

    # Generate a reset token.
    token = secrets.token_urlsafe(32)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=30)
    ).isoformat()

    db.create_password_reset(token, user_id, expires_at)

    base_url = os.getenv("APP_BASE_URL", "http://localhost:5173")
    reset_url = f"{base_url}/reset?token={token}"

    # ALWAYS log the URL — useful for testing without a verified domain.
    print(f"[PASSWORD RESET] {email} → {reset_url}")

    # Best-effort send. If it fails, we still return success.
    send_password_reset_email(email, reset_url)

    return generic_response

@router.post("/auth/reset-password")
def reset_password(request: ResetPasswordRequest, http_request: Request):
    ip = http_request.client.host if http_request.client else "unknown"
    if not rate_allowed(f"reset:{ip}", 7):
        raise HTTPException(
            status_code=429,
            detail="Too many reset attempts. Please try again in a minute."
        )

    if len(request.new_password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters long."
        )

    row = db.get_password_reset(request.token)

    if row is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset link."
        )

    _token, user_id, _created_at, expires_at, used = row

    if used:
        raise HTTPException(
            status_code=400,
            detail="This reset link has already been used."
        )

    # Check expiry.
    try:
        expiry = datetime.fromisoformat(expires_at)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid reset link."
        )

    if datetime.now(timezone.utc) > expiry:
        raise HTTPException(
            status_code=400,
            detail="This reset link has expired. Please request a new one."
        )

    # Update the password.
    new_hash = hash_value(request.new_password)
    db.update_password(user_id, new_hash)

    # Mark the token used + revoke all sessions.
    db.mark_password_reset_used(request.token)
    db.delete_user_sessions(user_id)

    return {"message": "Password reset successfully. Please log in."}


def _extract_token(authorization: str) -> str:

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header."
        )

    return authorization.removeprefix("Bearer ")


def get_current_user(
    authorization: str = Header(...)
) -> str:

    token = _extract_token(authorization)

    session = db.get_session(token)

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired session."
        )

    # session row: (token, user_id, created_at, expires_at)
    _, user_id, _, expires_at = session

    # Check expiry.
    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at)
            if datetime.now(timezone.utc) > expiry:
                db.delete_session(token)
                raise HTTPException(
                    status_code=401,
                    detail="Session expired. Please log in again."
                )
        except (ValueError, TypeError):
            pass  # treat as valid if unparseable

    # Sliding refresh: extend by 30 days on every authenticated request.
    db.refresh_session(token)

    return user_id


def get_current_user_record(
    authorization: str = Header(...)
) -> tuple:
    """
    Same as get_current_user, but returns the full user row so
    callers can inspect the role. Used by admin endpoints.
    """

    token = _extract_token(authorization)

    session = db.get_session(token)

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired session."
        )

    # session row: (token, user_id, created_at, expires_at)
    _, user_id, _, expires_at = session

    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at)
            if datetime.now(timezone.utc) > expiry:
                db.delete_session(token)
                raise HTTPException(
                    status_code=401,
                    detail="Session expired. Please log in again."
                )
        except (ValueError, TypeError):
            pass

    db.refresh_session(token)

    user = db.get_user_by_id(user_id)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User no longer exists."
        )

    return user


def require_admin(
    user = Depends(get_current_user_record)
):
    """
    Dependency: only allow users whose role is 'admin'.
    Raises 403 otherwise.
    """

    # user row: (user_id, email, password_hash, security_question,
    #            security_answer_hash, created_at, role, avatar_data)
    role = user[6] if len(user) > 6 else "user"

    if role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin privileges required."
        )

    return user


from schemas.auth import (
    ChangeEmailRequest,
    ChangePasswordRequest,
    DeleteAccountRequest,
)


@router.get("/auth/me")
def get_me(user_id: str = Depends(get_current_user)):
    """Return the current user's profile info."""

    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    (
        _user_id,
        email,
        _password_hash,
        _security_question,
        _security_answer_hash,
        created_at,
        role,
        _avatar_data,
    ) = user

    return {
        "user_id": _user_id,
        "email": email,
        "role": role,
        "created_at": created_at,
    }


@router.post("/auth/change-email")
def change_email(
    request: ChangeEmailRequest,
    user_id: str = Depends(get_current_user)
):
    """Change the current user's email. Requires password confirmation."""

    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    password_hash = user[2]

    if not verify_value(request.current_password, password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    new_email = str(request.new_email).strip().lower()
    if not new_email:
        raise HTTPException(status_code=400, detail="Email cannot be empty.")

    existing = db.get_user_by_email(new_email)
    if existing is not None and existing[0] != user_id:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists."
        )

    db.update_user_email(user_id, new_email)

    return {"message": "Email updated successfully.", "email": new_email}


@router.post("/auth/change-password")
def change_password(
    request: ChangePasswordRequest,
    user_id: str = Depends(get_current_user)
):
    """Change the current user's password. Requires the current password."""

    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    password_hash = user[2]

    if not verify_value(request.current_password, password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    if len(request.new_password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters long."
        )

    if request.new_password == request.current_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current one."
        )

    new_hash = hash_value(request.new_password)
    db.update_password(user_id, new_hash)

    return {"message": "Password updated successfully."}


@router.delete("/auth/account")
def delete_account(
    request: DeleteAccountRequest,
    user_id: str = Depends(get_current_user)
):
    """Permanently delete the current user's account and all data."""

    if request.confirm_text.strip() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail='You must type "DELETE" to confirm.'
        )

    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    password_hash = user[2]
    if not verify_value(request.current_password, password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    # Clean up vector stores first (Chroma).
    try:
        rag_service = rag_state.get_rag_service(user_id)
        rag_service.delete_user_chroma_collections()
        # Drop the cached service so a re-login doesn't reuse stale state.
        rag_state.drop_rag_service(user_id)
    except Exception:
        pass

    # Then wipe SQL rows.
    counts = db.delete_user_and_data(user_id)

    return {
        "message": "Account deleted.",
        "deleted": counts,
    }


@router.get("/auth/dashboard")
def get_dashboard(user_id: str = Depends(get_current_user)):
    """
    Return the current user's dashboard stats + recent chats.
    """

    user = db.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    created_at = user[5]
    role = user[6]

    stats = db.get_user_dashboard_stats(user_id)
    usage = db.get_user_usage_stats(user_id)

    # Recent chats — pull from the cached RAG service (already loaded
    # with message counts) and sort by most recent activity.
    recent_chats = []
    try:
        rag_service = rag_state.get_rag_service(user_id)
        chat_items = []
        for chat_id, chat in rag_service.chats.items():
            messages = chat.get("messages", [])
            if not messages:
                continue
            last_msg = messages[-1]
            chat_items.append({
                "chat_id": chat_id,
                "name": chat.get("name", "Untitled"),
                "message_count": len(messages),
                "archived": bool(chat.get("archived", False)),
                "last_message_at": last_msg.get("created_at", ""),
            })

        # Sort by last_message_at descending, take top 5.
        chat_items.sort(key=lambda c: c.get("last_message_at", ""), reverse=True)
        recent_chats = chat_items[:5]
    except Exception:
        recent_chats = []

    return {
        "user_id": user_id,
        "email": user[1],
        "role": role,
        "member_since": created_at,
        "stats": stats,
        "usage": usage,
        "recent_chats": recent_chats,
    }
    