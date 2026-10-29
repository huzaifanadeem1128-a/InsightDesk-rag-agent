import threading
from rag_engine import RAGService


_rag_services: dict[str, RAGService] = {}
_lock = threading.Lock()


def get_rag_service(user_id: str) -> RAGService:
    # Fast path: already created.
    if user_id in _rag_services:
        return _rag_services[user_id]

    # Slow path: serialize creation so only one thread loads the model.
    with _lock:
        # Double-check after acquiring the lock — another thread
        # may have created it while we waited.
        if user_id not in _rag_services:
            _rag_services[user_id] = RAGService(user_id=user_id)
        return _rag_services[user_id]
    
def drop_rag_service(user_id: str) -> None:
    """Remove a cached RAGService for a user (e.g. after account deletion)."""

    with _lock:
        _rag_services.pop(user_id, None)