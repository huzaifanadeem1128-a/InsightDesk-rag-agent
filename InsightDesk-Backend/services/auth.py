import secrets
import uuid

from passlib.context import CryptContext


password_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


def hash_value(value: str) -> str:
    return password_context.hash(value)


def verify_value(
    value: str,
    hashed_value: str
) -> bool:
    return password_context.verify(
        value,
        hashed_value
    )


def generate_user_id() -> str:
    return f"user_{uuid.uuid4().hex}"


def generate_session_token() -> str:
    return secrets.token_hex(32)