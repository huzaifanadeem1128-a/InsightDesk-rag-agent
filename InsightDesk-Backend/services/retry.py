"""
Groq rate-limit aware retry helper.

Wraps LLM invocation calls with exponential backoff on 429 errors
(rate limit exceeded). All other exceptions are re-raised unchanged.

Usage:

    from services.retry import invoke_with_retry, stream_with_retry

    response = invoke_with_retry(self.llm, messages)
    for chunk in stream_with_retry(self.llm, messages):
        ...
"""

import time
import re
from typing import Callable


MAX_RETRIES = 3
BASE_DELAY = 3.0     # seconds
MAX_DELAY = 60.0    # cap


def _is_rate_limit_error(exc: Exception) -> bool:
    """Detect Groq 429 rate limit errors."""
    msg = str(exc).lower()
    if "429" in msg:
        return True
    if "rate limit" in msg or "rate_limit_exceeded" in msg:
        return True
    if "tokens per day" in msg or "tokens per minute" in msg:
        return True
    return False


def _extract_retry_after(exc: Exception) -> float | None:
    """Groq often includes 'Please try again in Xs' in the message."""
    msg = str(exc)
    # Patterns like "try again in 9.45s" or "try again in 15m30s"
    m = re.search(r"try again in (\d+)m(\d+(?:\.\d+)?)s", msg)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    m = re.search(r"try again in (\d+(?:\.\d+)?)s", msg)
    if m:
        return float(m.group(1))
    return None


def _compute_delay(attempt: int, exc: Exception) -> float:
    """Exponential backoff, but respect the retry-after hint if present."""
    hint = _extract_retry_after(exc)
    if hint is not None:
        # Add small buffer over the hint.
        return min(hint + 1.0, MAX_DELAY)

    delay = BASE_DELAY * (2 ** attempt)
    return min(delay, MAX_DELAY)


def invoke_with_retry(llm, messages, **kwargs):
    """
    Invoke an LLM with retry on rate limits.

    Retries up to MAX_RETRIES times, sleeping between attempts.
    Re-raises the last exception if all retries fail.
    """
    last_exc = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            return llm.invoke(messages, **kwargs)
        except Exception as exc:
            last_exc = exc
            if not _is_rate_limit_error(exc) or attempt == MAX_RETRIES:
                raise
            delay = _compute_delay(attempt, exc)
            print(f"[RETRY] Rate limit hit. Waiting {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})...")
            time.sleep(delay)
    # Should not reach here.
    raise last_exc


def stream_with_retry(llm, messages, **kwargs):
    """
    Streaming variant.

    Note: retry only applies to the INITIAL connection. Once streaming
    has started, no retry — the caller would need to reconstruct state.
    """
    last_exc = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            iterator = llm.stream(messages, **kwargs)
            # Force the first chunk to surface connection errors before yielding.
            first = next(iterator, None)
            if first is None:
                return
            yield first
            for chunk in iterator:
                yield chunk
            return
        except Exception as exc:
            last_exc = exc
            if not _is_rate_limit_error(exc) or attempt == MAX_RETRIES:
                raise
            delay = _compute_delay(attempt, exc)
            print(f"[RETRY] Rate limit hit. Waiting {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})...")
            time.sleep(delay)
    raise last_exc