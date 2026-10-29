import base64
import json
import os

from database import Database

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.responses import StreamingResponse

from schemas.chat import ChatRequest
from services import rag_state
from services.guardrails import check_user_input
from routes.auth import get_current_user
from services.rate_limit import is_allowed as rate_allowed


router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/chat")
def chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user)
):

    rag_service = rag_state.get_rag_service(user_id)

    if not request.question.strip():

        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty."
        )

    if request.chat_id not in rag_service.chats:

        raise HTTPException(
            status_code=404,
            detail="Chat not found."
        )

    if request.chat_id != rag_service.current_chat_id:

        rag_service.switch_chat(
            request.chat_id
        )

    safe, reason = check_user_input(request.question)

    if not safe:

        raise HTTPException(
            status_code=400,
            detail=reason
        )

    try:

        answer, documents = rag_service.ask(
            request.question,
            document_ids=request.document_ids,
        )

        sources = []

        for document in documents:

            sources.append({
                "document_id": document.metadata.get("document_id"),
                "source": document.metadata.get("source"),
                "page": document.metadata.get("page")
            })

        return {

            "chat_id": rag_service.current_chat_id,
            "question": request.question,
            "answer": answer,
            "sources": sources,
            "activity": rag_service.get_agent_activity()
        }

    except RuntimeError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


@router.post("/chat/stream")
def chat_stream(
    request: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user)
):

    _db = Database()
    _user = _db.get_user_by_id(user_id)
    _is_admin = _user is not None and len(_user) > 6 and _user[6] == "admin"

    if not _is_admin and not rate_allowed(f"chat:{user_id}", 30):
        raise HTTPException(
            status_code=429,
            detail="You're sending messages too quickly. Please wait a moment."
        )

    rag_service = rag_state.get_rag_service(user_id)

    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    if request.chat_id not in rag_service.chats:
        raise HTTPException(status_code=404, detail="Chat not found.")

    if request.chat_id != rag_service.current_chat_id:
        rag_service.switch_chat(request.chat_id)
        

    safe, reason = check_user_input(request.question)

    if not safe:

        def blocked_generator():

            yield _sse(
                "error",
                {"detail": reason}
            )

        return StreamingResponse(
            blocked_generator(),
            media_type="text/event-stream"
        )


    def event_generator():

        try:

            regenerate_temp = 0.4 if getattr(request, "regenerate", False) else None
            for event in rag_service.ask_stream(
                request.question,
                document_ids=request.document_ids,
                temperature=regenerate_temp,
                image_data=request.image_data,
            ):

                if event["type"] == "token":
                    yield _sse("token", {"text": event["text"]})

                elif event["type"] == "activity":
                    yield _sse("activity", {"activity_type": event["activity_type"], "message": event["message"]})

                elif event["type"] == "title":
                    yield _sse("title", {
                        "chat_id": event["chat_id"],
                        "name": event["name"],
                    })

                elif event["type"] == "saved":
                    yield _sse("done", {"sources": event["sources"], "chat_id": rag_service.current_chat_id})

        except RuntimeError as error:
            yield _sse("error", {"detail": str(error)})

        except Exception as error:
            err_msg = str(error)
            if "429" in err_msg or "rate limit" in err_msg.lower():
                yield _sse("error", {
                    "detail": "The AI is temporarily rate-limited. Please try again in a minute."
                })
            else:
                yield _sse("error", {"detail": f"An unexpected error occurred: {error}"})

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ============================================================
# VOICE TRANSCRIPTION (Groq Whisper)
# ============================================================

@router.post("/chat/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """
    Accepts an audio file and returns its transcription via Groq Whisper.

    Requires a valid session. Audio format: webm/opus or mp4/aac
    (browser MediaRecorder output).
    """

    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Groq API key not configured.")

    # Read the uploaded audio bytes.
    try:
        audio_bytes = await audio.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read audio file: {e}")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    # Reject clips shorter than ~2000 bytes.
    # Very short or silent clips often cause Whisper to hallucinate
    # random phrases. This is a defense-in-depth check on top of the
    # client-side voice-activity detection.
    if len(audio_bytes) < 2000:
        raise HTTPException(
            status_code=400,
            detail="Audio too short. Please speak for longer."
        )

    # Cap file size: ~10 MB (roughly 10 minutes of opus audio).
    if len(audio_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 10MB).")

    # Call Groq Whisper.
    try:
        client = Groq(api_key=api_key)

        # Groq SDK expects a tuple: (filename, bytes, content_type)
        filename = audio.filename or "audio.webm"
        content_type = audio.content_type or "audio/webm"

        transcription = client.audio.transcriptions.create(
            file=(filename, audio_bytes, content_type),
            model="whisper-large-v3-turbo",
            response_format="text",
        )

        text = transcription if isinstance(transcription, str) else str(transcription)
        text = text.strip()

        return {"text": text}

    except Exception as e:
        err = str(e)
        if "429" in err or "rate limit" in err.lower():
            raise HTTPException(
                status_code=429,
                detail="Transcription service is rate-limited. Please try again in a moment."
            )
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {err}"
        )
        
# ============================================================
# IMAGE → TEXT (Qwen Vision on Groq)
# ============================================================

VISION_MODEL = "qwen/qwen3.8-27b"
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/chat/extract-image-text")
async def extract_image_text(
    image: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """
    Extract question text from an uploaded image using Groq's
    Qwen vision model. Returns {"text": "<extracted question>"}.
    """

    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Groq API key not configured.")

    # Read image bytes.
    try:
        image_bytes = await image.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read image: {e}")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image.")

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large (max {MAX_IMAGE_BYTES // (1024*1024)}MB)."
        )

    # Encode as base64 data URL for the vision API.
    mime = image.content_type or "image/png"
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    # Call Qwen vision via Groq.
    try:
        client = Groq(api_key=api_key)

        response = client.chat.completions.create(
            model=VISION_MODEL,
            temperature=0,
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract the question or questions from this image. "
                                "Return only the question text, nothing else. "
                                "If the image contains no question, respond with exactly: "
                                "NO_QUESTION_FOUND"
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ],
        )

        extracted = (response.choices[0].message.content or "").strip()

        if not extracted or "NO_QUESTION_FOUND" in extracted:
            raise HTTPException(
                status_code=400,
                detail="No question found in the image. Please try another image."
            )

        return {"text": extracted}

    except HTTPException:
        raise
    except Exception as e:
        err = str(e)
        if "429" in err or "rate limit" in err.lower():
            raise HTTPException(
                status_code=429,
                detail="Image service is rate-limited. Please try again in a moment."
            )
        raise HTTPException(
            status_code=500,
            detail=f"Image extraction failed: {err}"
        )