from pydantic import BaseModel


class ChatRequest(BaseModel):
    chat_id: str
    question: str
    document_ids: list[str] | None = None
    regenerate: bool = False
    image_data: str | None = None