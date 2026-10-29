from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    HTTPException,
    Depends
)

from rag_engine import (
    EMBEDDING_MODEL,
    GROQ_MODEL
)

from services import rag_state
from routes.auth import get_current_user

from schemas.documents import (
    DocumentInfo,
    DocumentListResponse
)

from database import Database


router = APIRouter(tags=["Documents"])
db = Database()



class UploadedFileAdapter:

    def __init__(
        self,
        name,
        data
    ):
        self.name = name
        self.data = data

    def getvalue(self):
        return self.data


@router.post("/documents")
async def process_documents(

    files: list[UploadFile] = File(...),

    chunk_size: int = Form(800),

    chunk_overlap: int = Form(150),

    top_k: int = Form(4),

    user_id: str = Depends(get_current_user)
):

    if not files:

        raise HTTPException(
            status_code=400,
            detail="No files were uploaded."
        )

    if chunk_size <= 0:

        raise HTTPException(
            status_code=400,
            detail=(
                "Chunk size must be "
                "greater than 0."
            )
        )

    if chunk_overlap < 0:

        raise HTTPException(
            status_code=400,
            detail=(
                "Chunk overlap cannot "
                "be negative."
            )
        )

    if chunk_overlap >= chunk_size:

        raise HTTPException(
            status_code=400,
            detail=(
                "Chunk overlap must be "
                "smaller than chunk size."
            )
        )

    if top_k <= 0:

        raise HTTPException(
            status_code=400,
            detail=(
                "Top K must be "
                "greater than 0."
            )
        )

    uploaded_files = []

    for file in files:

        data = await file.read()

        uploaded_files.append(
            UploadedFileAdapter(
                file.filename,
                data
            )
        )

    try:

        rag_service = rag_state.get_rag_service(
            user_id
        )

        result = rag_service.add_documents(
            uploaded_files,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            top_k=top_k,
        )

        processing_info = {

            "document_count":
                result.get(
                    "documents",
                    0
                ),

            "chunk_count":
                result.get(
                    "chunks",
                    0
                ),

            "embedding_dimension":
                result.get(
                    "embedding_dimension",
                    "-"
                ),

            "embedding_model":
                result.get(
                    "embedding_model",
                    EMBEDDING_MODEL
                ),

            "llm_model":
                result.get(
                    "llm_model",
                    GROQ_MODEL
                ),

            "chunk_size":
                result.get(
                    "chunk_size",
                    chunk_size
                ),

            "chunk_overlap":
                result.get(
                    "chunk_overlap",
                    chunk_overlap
                ),

            "top_k":
                result.get(
                    "top_k",
                    top_k
                ),

            "document_names":
                result.get(
                    "document_names",
                    []
                ),

            "document_ids":
                result.get(
                    "document_ids",
                    []
                ),

            "document_map":
                result.get(
                    "document_map",
                    {}
                ),

            "skipped_documents":
                result.get(
                    "skipped_documents",
                    []
                )
        }

        message = "Documents processed successfully."

        if result.get("documents", 0) == 0:

            message = "All uploaded documents were already in the knowledge base."

        return {

            "message": message,

            "processing_info": processing_info
        }

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


@router.get(
    "/documents",
    response_model=DocumentListResponse
)
def get_documents(
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    document_map = rag_service.document_map

    documents = []

    for document_id, document_name in (
        document_map.items()
    ):

        documents.append(
            DocumentInfo(
                document_id=document_id,
                name=document_name
            )
        )

    return DocumentListResponse(
        documents=documents,
        count=len(documents)
    )
    
@router.delete("/documents/{document_id}")
def delete_document(
    document_id: str,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    if document_id not in rag_service.document_map:

        raise HTTPException(
            status_code=404,
            detail="Document not found."
        )

    try:

        result = rag_service.remove_document(
            document_id
        )

    except ValueError as error:

        raise HTTPException(
            status_code=404,
            detail=str(error)
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )

    archived = result.get("archived_chats", 0) if result else 0

    return {

        "message": "Document deleted successfully.",

        "document_id": document_id,

        "archived_chats": archived
    }


@router.get("/documents/{document_id}/impact")
def document_impact(
    document_id: str,
    user_id: str = Depends(get_current_user)
):
    """
    Report how many chats use this document — shown to the user
    before they confirm deletion.
    """

    rag_service = rag_state.get_rag_service(user_id)

    if document_id not in rag_service.document_map:

        raise HTTPException(
            status_code=404,
            detail="Document not found."
        )

    rows = db.get_chats_using_document(document_id)

    # Only count chats belonging to this user.
    user_chats = [
        row for row in rows
        if row[2] == user_id
    ]

    active = [row for row in user_chats if not row[3]]
    archived = [row for row in user_chats if row[3]]

    return {
        "document_id": document_id,
        "document_name": rag_service.document_map.get(document_id),
        "affected_chats": len(active),
        "already_archived": len(archived),
        "chats": [
            {
                "chat_id": row[0],
                "name": row[1],
                "archived": bool(row[3]),
            }
            for row in user_chats
        ],
    }
    
