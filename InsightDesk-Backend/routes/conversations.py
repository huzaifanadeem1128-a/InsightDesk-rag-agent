from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from urllib.parse import quote

from schemas.conversations import (
    CreateChatRequest,
    RenameChatRequest
)
from services import rag_state
from routes.auth import get_current_user


router = APIRouter(tags=["Chats"])


@router.get("/chats")
def get_chats(
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    chats = []

    for chat_id, chat in rag_service.chats.items():

        chats.append({

            "chat_id":
                chat_id,

            "name":
                chat["name"],

            "archived":
                chat.get("archived", False),

            "pinned":
                chat.get("pinned", False),

            "message_count":
                len(
                    chat["messages"]
                )
        })

    return {

        "current_chat_id":
            rag_service.current_chat_id,

        "chats":
            chats
    }


@router.post("/chats")
def create_chat(
    request: CreateChatRequest,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    chat_id = rag_service.create_chat(
        request.name
    )

    return {

        "chat_id":
            chat_id,

        "name":
            request.name
    }


@router.get("/chats/{chat_id}")
def get_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    if chat_id not in rag_service.chats:

        raise HTTPException(
            status_code=404,
            detail="Chat not found."
        )

    chat = rag_service.chats[chat_id]

    return {

        "chat_id":
            chat_id,

        "name":
            chat["name"],

        "archived":
            chat.get("archived", False),

        "messages":
            chat["messages"],

        "is_current":
            chat_id ==
            rag_service.current_chat_id
    }


@router.post("/chats/{chat_id}/switch")
def switch_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    if chat_id not in rag_service.chats:

        raise HTTPException(
            status_code=404,
            detail="Chat not found."
        )

    rag_service.switch_chat(
        chat_id
    )

    return {

        "message":
            "Chat switched successfully.",

        "current_chat_id":
            rag_service.current_chat_id,

        "messages":
            rag_service.get_current_messages()
    }


@router.put("/chats/{chat_id}")
def rename_chat(
    chat_id: str,
    request: RenameChatRequest,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    if chat_id not in rag_service.chats:

        raise HTTPException(
            status_code=404,
            detail="Chat not found."
        )

    rag_service.rename_chat(
        chat_id,
        request.name
    )

    return {

        "message":
            "Chat renamed successfully.",

        "chat_id":
            chat_id,

        "name":
            request.name
    }

@router.post("/chats/{chat_id}/pin")
def toggle_chat_pin(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):
    """Toggle the pinned flag on a conversation."""

    rag_service = rag_state.get_rag_service(user_id)

    if chat_id not in rag_service.chats:
        raise HTTPException(status_code=404, detail="Chat not found.")

    try:
        new_state = rag_service.toggle_chat_pin(chat_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {"chat_id": chat_id, "pinned": new_state}

@router.delete("/chats/{chat_id}")
def delete_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(
        user_id
    )

    if chat_id not in rag_service.chats:

        raise HTTPException(
            status_code=404,
            detail="Chat not found."
        )

    rag_service.delete_chat(
        chat_id
    )

    return {

        "message":
            "Chat deleted successfully.",

        "current_chat_id":
            rag_service.current_chat_id
    }
    
@router.post("/messages/{message_id}/pin")
def toggle_pin_message(
    message_id: int,
    user_id: str = Depends(get_current_user)
):
    """Toggle the pinned flag on a message. Only the message owner can pin."""

    from database import Database
    db = Database()

    # Verify the message belongs to a chat owned by this user.
    conn = db.connect()
    try:
        row = conn.execute(
            """
            SELECT c.user_id
            FROM messages m
            JOIN conversations c ON c.chat_id = m.chat_id
            WHERE m.message_id = ?
            """,
            (message_id,)
        ).fetchone()
    finally:
        conn.close()

    if row is None or row[0] != user_id:
        raise HTTPException(status_code=404, detail="Message not found.")

    try:
        new_state = db.toggle_pin_message(message_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {"message_id": message_id, "pinned": new_state}

@router.get("/chats/{chat_id}/export.md")
def export_chat_markdown(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):
    """Download a chat as a Markdown file."""

    rag_service = rag_state.get_rag_service(user_id)

    if chat_id not in rag_service.chats:
        raise HTTPException(status_code=404, detail="Chat not found.")

    markdown = rag_service.build_markdown(chat_id)
    if markdown is None:
        raise HTTPException(status_code=404, detail="Chat not found.")

    chat_name = rag_service.chats[chat_id].get("name", "chat")
    safe_name = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else "_"
        for c in chat_name
    ).strip() or "chat"

    filename = f"{safe_name}.md"
    encoded = quote(filename)

    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"
        }
    )


@router.get("/chats/{chat_id}/export.pdf")
def export_chat_pdf(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):
    """Download a chat as a PDF file."""

    rag_service = rag_state.get_rag_service(user_id)

    if chat_id not in rag_service.chats:
        raise HTTPException(status_code=404, detail="Chat not found.")

    pdf_bytes = rag_service.build_pdf_bytes(chat_id)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Chat not found.")

    chat_name = rag_service.chats[chat_id].get("name", "chat")
    safe_name = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else "_"
        for c in chat_name
    ).strip() or "chat"

    filename = f"{safe_name}.pdf"
    encoded = quote(filename)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"
        }
    )
    
@router.get("/chats/{chat_id}/suggestions")
def chat_suggestions(
    chat_id: str,
    user_id: str = Depends(get_current_user)
):
    """Return up to 3 suggested questions for an empty chat."""

    rag_service = rag_state.get_rag_service(user_id)

    if chat_id not in rag_service.chats:
        raise HTTPException(status_code=404, detail="Chat not found.")

    try:
        suggestions = rag_service.suggest_questions(chat_id)
    except Exception:
        suggestions = []

    return {"suggestions": suggestions}