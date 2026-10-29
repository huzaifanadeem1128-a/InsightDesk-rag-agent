"""
In-memory rate limiter.

Tracks request counts per key (usually IP or user_id) within
a rolling 60-second window. Not thread-safe in a multi-process
deployment — fine for a single uvicorn worker.
"""

import time
from collections import defaultdict, deque
from threading import Lock


# key -> deque of timestamps
_buckets: dict[str, deque] = defaultdict(deque)
_lock = Lock()

WINDOW_SECONDS = 60


def is_allowed(key: str, max_requests: int) -> bool:
    """
    Return True if the key is under the limit.

    Removes old timestamps outside the window, then checks the count.
    """

    now = time.time()
    cutoff = now - WINDOW_SECONDS

    with _lock:
        bucket = _buckets[key]

        # Drop expired timestamps.
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= max_requests:
            return False

        bucket.append(now)
        return True


def reset(key: str) -> None:
    """Clear the bucket for a key (useful in tests)."""
    with _lock:
        _buckets.pop(key, None)