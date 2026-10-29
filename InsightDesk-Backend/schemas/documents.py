from pydantic import BaseModel


class DocumentInfo(BaseModel):
    document_id: str
    name: str


class DocumentListResponse(BaseModel):
    documents: list[DocumentInfo]
    count: int
    