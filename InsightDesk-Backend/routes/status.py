from fastapi import APIRouter, Depends

from rag_engine import (
    EMBEDDING_MODEL,
    GROQ_MODEL
)

from services import rag_state
from routes.auth import get_current_user


router = APIRouter(tags=["RAG Status"])


@router.get("/rag/status")
def rag_status(
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    return {

        "documents":
            list(
                rag_service.retrievers.keys()
            ),

        "document_count":
            len(
                rag_service.retrievers
            ),

        "chat_count":
            len(
                rag_service.chats
            ),

        "current_chat_id":
            rag_service.current_chat_id,

        "chunk_size":
            rag_service.chunk_size,

        "chunk_overlap":
            rag_service.chunk_overlap,

        "top_k":
            rag_service.top_k,

        "llm_model":
            GROQ_MODEL,

        "embedding_model":
            EMBEDDING_MODEL
    }