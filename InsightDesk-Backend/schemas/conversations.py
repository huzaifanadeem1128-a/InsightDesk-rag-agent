from pydantic import BaseModel


class CreateChatRequest(BaseModel):
    name: str = "New Chat"


class RenameChatRequest(BaseModel):
    name: str