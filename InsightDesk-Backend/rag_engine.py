import json
import os
import uuid
import hashlib
from functools import lru_cache
from typing import Iterable

from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
)

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_chroma import Chroma

from database import Database

from services.ingestion import (
    build_document_index,
    MAX_CANDIDATE_K
)

from services.retrieval import (
    RetrievalWrapper
)

from services.agent import (
    AgentService
)

from services.guardrails import redact_pii

from datetime import datetime, timezone

load_dotenv()


EMBEDDING_MODEL = (
    "sentence-transformers/all-MiniLM-L6-v2"
)

GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_MODEL_SMALL = "openai/gpt-oss-20b"
MAX_OUTPUT_TOKENS = 2048
MAX_LLM_HISTORY_MESSAGES = 6
MEMORY_COLLECTION_PREFIX = "memory_"
MEMORY_MAX_RESULTS = 6


# --------------------------------------------------
# PHASE 5 - MEMORY LIMITS
# --------------------------------------------------

MAX_LLM_HISTORY_MESSAGES = 6


@lru_cache(maxsize=1)
def get_embedding_model() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


class RAGService:

    def __init__(
        self,
        user_id: str,
        chunk_size: int = 800,
        chunk_overlap: int = 150,
        top_k: int = 4
    ) -> None:

        if not os.getenv("GROQ_API_KEY"):
            raise ValueError(
                "GROQ_API_KEY is not set"
            )

        self.user_id = user_id

        if chunk_size <= 0:
            raise ValueError(
                "chunk_size must be greater than 0"
            )

        if chunk_overlap < 0:
            raise ValueError(
                "chunk_overlap cannot be negative"
            )

        if chunk_overlap >= chunk_size:
            raise ValueError(
                "chunk_overlap must be smaller than chunk size"
            )

        if top_k <= 0:
            raise ValueError(
                "top_k must be greater than 0"
            )

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.top_k = top_k

        self.embedding_model = get_embedding_model()

        self.llm = ChatGroq(
            model=GROQ_MODEL,
            temperature=0,
            max_retries=2,
            max_tokens=MAX_OUTPUT_TOKENS,
        )

        # --------------------------------------------------
        # DOCUMENT STORAGE
        # --------------------------------------------------

        self.vector_stores = {}
        self.retrievers = {}
        self.documents = []
        self.chunks = []

        # document_id -> filename
        self.document_map = {}

        # --------------------------------------------------
        # DATABASE
        # --------------------------------------------------

        self.db = Database()
        self.db.create_table()
        
        self._load_existing_documents()

        self.chats = self._load_chats()

        self.current_chat_id = None

        # Full current chat history.
        # This is kept for storage/application use.
        # Only a limited part is sent to the LLM.
        self.chat_history = []

        if self.chats:

            self.current_chat_id = next(
                iter(self.chats)
            )

            self._load_current_chat_history()

        else:

            self.create_chat()
            
        # Memory vector store (semantic search over past user messages).
        self.memory_store = self._build_memory_store()

        self.last_retrieved_docs = []
        self.agent_activity = []

    # --------------------------------------------------
    # CHAT STORAGE
    # --------------------------------------------------

    def _load_chats(self) -> dict:

        rows = self.db.get_conversations(
            self.user_id
        )

        chats = {}

        for (
            chat_id,
            name,
            created_at,
            archived,
            pinned
        ) in rows:

            messages = self.db.get_messages(
                chat_id
            )

            chats[chat_id] = {
                "name": name,
                "archived": bool(archived),
                "pinned": bool(pinned),
                "messages": []
            }

            for (
                message_id,
                role,
                content,
                sources,
                activity,
                message_created_at,
                pinned,
                image_data
            ) in messages:

                message = {
                    "role": role,
                    "content": content,
                    "message_id": message_id,
                    "created_at": message_created_at,
                    "pinned": bool(pinned),
                }

                if image_data:
                    message["image_data"] = image_data

                if sources:

                    message["sources"] = json.loads(
                        sources
                    )

                if activity:

                    message["activity"] = json.loads(
                        activity
                    )

                chats[chat_id]["messages"].append(
                    message
                )

        return chats
    
    def _build_memory_store(self):
        """
        Build (or reuse) a Chroma collection that stores embeddings
        of every user message across all chats for this user.

        Used by semantic memory search.
        """

        collection_name = f"{MEMORY_COLLECTION_PREFIX}{self.user_id}"

        try:
            store = Chroma(
                collection_name=collection_name,
                embedding_function=self.embedding_model,
                persist_directory="./chroma_db",
                collection_metadata={"hnsw:space": "cosine"},
            )
        except Exception:
            return None

        # Check if it's empty — if so, populate it from all existing messages.
        try:
            existing = store.get(limit=1)
            if not existing or not existing.get("ids"):
                self._populate_memory_store(store)
        except Exception:
            self._populate_memory_store(store)

        return store

    def _populate_memory_store(self, store):
        """Embed and store every user message across all chats."""

        docs = []
        metadatas = []
        ids = []

        for chat_id, chat in self.chats.items():
            chat_name = chat.get("name", "Unnamed")
            for msg in chat.get("messages", []):
                if msg.get("role") != "user":
                    continue

                content = msg.get("content", "")
                if not content.strip():
                    continue

                # Skip duplicates (same message already in the store).
                mid = msg.get("message_id")
                if mid is None:
                    continue

                docs.append(content)
                metadatas.append({
                    "chat_id": chat_id,
                    "chat_name": chat_name,
                    "message_id": mid,
                    "created_at": msg.get("created_at", ""),
                })
                ids.append(f"mem_{mid}")

        if not docs:
            return

        try:
            store.add_texts(texts=docs, metadatas=metadatas, ids=ids)
        except Exception:
            pass

    def _add_to_memory_store(self, message_id, chat_id, chat_name, content, created_at):
        """Add a single user message to the memory store."""

        if not self.memory_store or not content.strip():
            return

        try:
            self.memory_store.add_texts(
                texts=[content],
                metadatas=[{
                    "chat_id": chat_id,
                    "chat_name": chat_name,
                    "message_id": message_id,
                    "created_at": created_at,
                }],
                ids=[f"mem_{message_id}"],
            )
        except Exception:
            pass
    
    def _load_existing_documents(self) -> None:

        rows = self.db.get_documents(
            self.user_id
        )

        for (
            document_id,
            name,
            collection_name,
            content_hash,
            chunk_size,
            chunk_overlap,
            top_k,
            created_at
        ) in rows:

            try:

                vector_store = Chroma(
                    collection_name=collection_name,
                    embedding_function=self.embedding_model,
                    persist_directory="./chroma_db",
                )

            except Exception:

                # Collection is missing or corrupted on disk.
                # Skip it rather than crashing startup; it will
                # simply not be searchable until re-uploaded.
                continue

            self.vector_stores[document_id] = vector_store

            candidate_k = max(
                MAX_CANDIDATE_K,
                1
            )

            base_retriever = vector_store.as_retriever(
                search_type="similarity",
                search_kwargs={
                    "k": candidate_k
                },
            )

            self.retrievers[document_id] = RetrievalWrapper(
                retriever=base_retriever,
                final_k=top_k,
                vector_store=vector_store,
            )

            self.document_map[document_id] = name

    def create_chat(
        self,
        name: str = "New Chat"
    ) -> str:

        chat_id = uuid.uuid4().hex

        self.db.create_conversation(
            chat_id,
            self.user_id,
            name
        )

        self.chats[chat_id] = {
            "name": name,
            "archived": False,
            "pinned": False,
            "messages": []
        }

        self.current_chat_id = chat_id
        self.chat_history = []

        return chat_id

    def switch_chat(
        self,
        chat_id: str
    ) -> None:

        if chat_id not in self.chats:

            raise ValueError(
                "Chat does not exist"
            )

        self.current_chat_id = chat_id

        self._load_current_chat_history()

    def rename_chat(
        self,
        chat_id: str,
        new_name: str
    ) -> None:

        if chat_id not in self.chats:

            raise ValueError(
                "Chat does not exist"
            )

        new_name = new_name.strip()

        if not new_name:

            raise ValueError(
                "Chat name cannot be empty"
            )

        self.db.rename_conversation(
            chat_id,
            new_name
        )

        self.chats[chat_id]["name"] = new_name
        
    def toggle_chat_pin(self, chat_id: str) -> bool:
        """Flip the pinned flag. Returns the new state."""

        if chat_id not in self.chats:
            raise ValueError("Chat does not exist")

        new_state = self.db.toggle_chat_pin(chat_id)
        self.chats[chat_id]["pinned"] = new_state
        return new_state

    def delete_chat(
        self,
        chat_id: str
    ) -> None:

        if chat_id not in self.chats:

            raise ValueError(
                "Chat does not exist"
            )

        deleting_current = (
            chat_id == self.current_chat_id
        )

        self.db.delete_conversation(
            chat_id
        )

        del self.chats[chat_id]

        if not self.chats:

            self.create_chat()
            return

        if deleting_current:

            self.current_chat_id = next(
                iter(self.chats)
            )

            self._load_current_chat_history()

    def get_chats(self) -> dict:
        return self.chats

    def _load_current_chat_history(
        self
    ) -> None:

        self.chat_history = []

        if not self.current_chat_id:
            return

        messages = self.chats[
            self.current_chat_id
        ]["messages"]

        for message in messages:

            if message["role"] == "user":

                self.chat_history.append(
                    HumanMessage(
                        content=message["content"]
                    )
                )

            elif message["role"] == "assistant":

                self.chat_history.append(
                    AIMessage(
                        content=message["content"]
                    )
                )

    # --------------------------------------------------
    # PHASE 5 - LLM HISTORY
    # --------------------------------------------------

    def _get_llm_history(self) -> list:

        """
        Return only recent conversation messages
        for the LLM.

        The complete history remains stored in
        SQLite and self.chat_history.
        """

        if not self.chat_history:

            return []

        return self.chat_history[
            -MAX_LLM_HISTORY_MESSAGES:
        ]

    def _save_current_message(
        self,
        role: str,
        content: str,
        sources: list | None = None,
        activity: list | None = None,
        image_data: str | None = None,
    ) -> None:

        new_message_id = self.db.add_message(
            chat_id=self.current_chat_id,
            role=role,
            content=content,
            sources=sources,
            activity=activity,
            image_data=image_data,
        )

        message = {
            "role": role,
            "content": content,
            "message_id": new_message_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "pinned": False,
        }

        if sources:
            message["sources"] = sources

        if activity:
            message["activity"] = activity

        if image_data:
            message["image_data"] = image_data

        self.chats[
            self.current_chat_id
        ]["messages"].append(
            message
        )

        if role == "user" and new_message_id is not None and content.strip():
            chat_name = self.chats.get(self.current_chat_id, {}).get("name", "Unnamed")
            self._add_to_memory_store(
                message_id=new_message_id,
                chat_id=self.current_chat_id,
                chat_name=chat_name,
                content=content,
                created_at=message["created_at"],
            )
    
    def _generate_and_save_title(self, chat_id: str, question: str) -> str | None:
        """
        Generate a short title for the chat from the user's first question
        and save it. Only runs when the chat still has the default name.

        Returns the new title if generated, else None.
        """

        chat = self.chats.get(chat_id)
        if not chat:
            return None

        current_name = chat.get("name", "")
        if current_name != "New Chat":
            return None

        try:
            prompt = (
                "Generate a short, descriptive title for a conversation "
                "that starts with this user question. "
                "Use 3 to 5 words. Do NOT include quotes, punctuation at "
                "the end, or the word 'Chat'. Just the title.\n\n"
                f"Question: {question}\n\n"
                "Title:"
            )

            from langchain_groq import ChatGroq
            from langchain_core.messages import HumanMessage

            title_llm = ChatGroq(
                model=GROQ_MODEL_SMALL,
                temperature=0.3,
                max_retries=1,
                max_tokens=200,
            )

            response = title_llm.invoke([HumanMessage(content=prompt)])
            raw = str(response.content or "").strip()

            title = raw.strip('"\'').strip()
            title = title.split("\n")[0].strip()
            title = title.rstrip(".!?,;:").strip()

            if len(title) > 60:
                title = title[:60].rstrip()

            if not title:
                return None

            self.db.update_conversation_name(chat_id, title)
            self.chats[chat_id]["name"] = title

            return title

        except Exception as e:
            print(f"[TITLE ERROR] {type(e).__name__}: {e}")
        try:
            prompt = (
                "Generate a short, descriptive title for a conversation "
                "that starts with this user question. "
                "Use 3 to 5 words. Do NOT include quotes, punctuation at "
                "the end, or the word 'Chat'. Just the title.\n\n"
                f"Question: {question}\n\n"
                "Title:"
            )

            from langchain_groq import ChatGroq
            from langchain_core.messages import HumanMessage

            title_llm = ChatGroq(
                model=GROQ_MODEL_SMALL,
                temperature=0.3,
                max_retries=1,
                max_tokens=200,
            )

            response = title_llm.invoke([HumanMessage(content=prompt)])
            raw = str(response.content or "").strip()

            title = raw.strip('"\'').strip()
            title = title.split("\n")[0].strip()
            title = title.rstrip(".!?,;:").strip()

            if len(title) > 60:
                title = title[:60].rstrip()

            if not title:
                raise ValueError("Empty title from LLM")

            self.db.update_conversation_name(chat_id, title)
            self.chats[chat_id]["name"] = title
            return title

        except Exception as e:
            print(f"[TITLE ERROR] {type(e).__name__}: {e}")

            # Fallback — derive a title from the question itself.
            fallback = self._fallback_title(question)
            if fallback:
                self.db.update_conversation_name(chat_id, fallback)
                self.chats[chat_id]["name"] = fallback
                return fallback

            return None
    @staticmethod
    def _fallback_title(question: str) -> str:
        """Derive a title from the first few words of the question."""
        words = question.strip().split()
        if not words:
            return ""
        title = " ".join(words[:5])
        if len(words) > 5:
            title += "…"
        if len(title) > 60:
            title = title[:60].rstrip()
        return title
    
    def build_markdown(self, chat_id: str) -> str | None:
        """Build a Markdown transcript of a chat. Returns None if chat missing."""

        chat = self.chats.get(chat_id)
        if not chat:
            return None

        lines = [f"# {chat.get('name', 'Untitled Chat')}", ""]

        for msg in chat.get("messages", []):
            role = msg.get("role")
            content = msg.get("content", "").strip()
            if not content:
                continue

            if role == "user":
                lines.append("## You")
                lines.append("")
                lines.append(content)
                lines.append("")

            elif role == "assistant":
                lines.append("## InsightDesk")
                lines.append("")
                lines.append(content)
                lines.append("")

                sources = msg.get("sources") or []
                if sources:
                    lines.append("**Sources:**")
                    for s in sources:
                        name = s.get("source", "Unknown")
                        page = s.get("page")
                        if page not in (None, "?", ""):
                            lines.append(f"- {name}, Page {page}")
                        else:
                            lines.append(f"- {name}")
                    lines.append("")

        return "\n".join(lines).rstrip() + "\n"

    def build_pdf_bytes(self, chat_id: str) -> bytes | None:
        """Build a PDF transcript of a chat. Returns None if chat missing."""

        chat = self.chats.get(chat_id)
        if not chat:
            return None

        from io import BytesIO
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer
        )
        from reportlab.lib.enums import TA_LEFT

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=LETTER,
            leftMargin=0.8 * inch,
            rightMargin=0.8 * inch,
            topMargin=0.8 * inch,
            bottomMargin=0.8 * inch,
            title=chat.get("name", "Chat"),
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "ChatTitle",
            parent=styles["Heading1"],
            fontSize=18,
            spaceAfter=16,
        )
        role_style = ParagraphStyle(
            "RoleLabel",
            parent=styles["Heading3"],
            fontSize=11,
            textColor="#444444",
            spaceBefore=10,
            spaceAfter=4,
        )
        body_style = ParagraphStyle(
            "Body",
            parent=styles["BodyText"],
            fontSize=10.5,
            leading=15,
            alignment=TA_LEFT,
        )
        source_style = ParagraphStyle(
            "Source",
            parent=styles["BodyText"],
            fontSize=9,
            leading=12,
            textColor="#666666",
            leftIndent=12,
        )

        def esc(text: str) -> str:
            return (
                str(text)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )

        flow = [Paragraph(esc(chat.get("name", "Untitled Chat")), title_style)]

        for msg in chat.get("messages", []):
            role = msg.get("role")
            content = (msg.get("content") or "").strip()
            if not content:
                continue

            if role == "user":
                flow.append(Paragraph("You", role_style))
                for para in content.split("\n\n"):
                    flow.append(Paragraph(esc(para).replace("\n", "<br/>"), body_style))
                    flow.append(Spacer(1, 4))

            elif role == "assistant":
                flow.append(Paragraph("InsightDesk", role_style))
                for para in content.split("\n\n"):
                    flow.append(Paragraph(esc(para).replace("\n", "<br/>"), body_style))
                    flow.append(Spacer(1, 4))

                sources = msg.get("sources") or []
                if sources:
                    flow.append(Paragraph("<b>Sources:</b>", source_style))
                    for s in sources:
                        name = s.get("source", "Unknown")
                        page = s.get("page")
                        if page not in (None, "?", ""):
                            line = f"• {esc(name)}, Page {esc(page)}"
                        else:
                            line = f"• {esc(name)}"
                        flow.append(Paragraph(line, source_style))
                    flow.append(Spacer(1, 6))

        doc.build(flow)
        return buffer.getvalue()
    
    def suggest_questions(self, chat_id: str, use_llm: bool = True) -> list[str]:
        """
        Return 3 suggested questions for an empty chat.

        Strategy:
          1. Build template suggestions from document names (always available).
          2. If use_llm=True, try to get smarter suggestions from a small LLM call.
             On success, return the LLM suggestions. On any failure, return templates.

        Never raises.
        """

        # ---- Build templates from document names ----
        doc_names = list(self.document_map.values())
        templates: list[str] = []

        if len(doc_names) == 0:
            # No documents → no suggestions.
            return []
        elif len(doc_names) == 1:
            name = doc_names[0]
            templates = [
                f"What is covered in {name}?",
                f"Summarize {name}",
                f"List the key points of {name}",
            ]
        else:
            name_a = doc_names[0]
            name_b = doc_names[1]
            templates = [
                f"Compare {name_a} and {name_b}",
                "Summarize all my documents",
                "What are the main topics across my documents?",
            ]

        if not use_llm:
            return templates

        # ---- Try LLM (best effort, silent failure) ----
        try:
            from langchain_groq import ChatGroq
            from langchain_core.messages import HumanMessage

            doc_list = ", ".join(doc_names) if doc_names else "(no documents uploaded)"

            prompt = (
                "You generate short, clickable question suggestions for a "
                "document Q&A app. The user has these documents available:\n"
                f"{doc_list}\n\n"
                "Suggest exactly 3 questions the user would realistically want "
                "to ask about these documents. Each question must be under 12 "
                "words. Return ONLY the 3 questions, one per line, no numbering, "
                "no quotes, no extra text."
            )

            llm = ChatGroq(
                model=GROQ_MODEL_SMALL,
                temperature=0.4,
                max_retries=1,
                max_tokens=200,
            )

            response = llm.invoke([HumanMessage(content=prompt)])
            raw = str(response.content or "").strip()

            # Split into lines, clean, filter, cap at 3.
            lines = [
                line.strip().lstrip("-•*1234567890. ").strip()
                for line in raw.split("\n")
            ]
            suggestions = [l for l in lines if 3 <= len(l) <= 120][:3]

            if len(suggestions) >= 3:
                return suggestions[:3]

            # Partial response → merge with templates.
            merged = suggestions + templates
            # De-dupe while preserving order.
            seen = set()
            result = []
            for q in merged:
                if q.lower() in seen:
                    continue
                seen.add(q.lower())
                result.append(q)
                if len(result) == 3:
                    break
            return result if result else templates

        except Exception as e:
            print(f"[SUGGEST ERROR] {type(e).__name__}: {e}")
            return templates
        
        
    def _replace_last_assistant_message(
        self,
        content: str,
        sources: list | None = None,
        activity: list | None = None,
    ) -> None:
        """
        Replace the most recent assistant message in the current chat.

        Used by the regenerate flow — we don't want to append a new
        message, we want to overwrite the existing answer.
        """

        messages = self.chats.get(self.current_chat_id, {}).get("messages", [])
        if not messages:
            return

        # Find the last assistant message (in reverse).
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "assistant":
                messages[i]["content"] = content
                messages[i]["sources"] = sources or []
                messages[i]["activity"] = activity or []
                # Also update the DB row.
                self.db.update_message(
                    message_id=messages[i].get("message_id"),
                    content=content,
                    sources=sources or [],
                    activity=activity or [],
                )
                break

    def get_current_messages(
        self
    ) -> list:

        if not self.current_chat_id:

            return []

        return self.chats[
            self.current_chat_id
        ]["messages"]

    # --------------------------------------------------
    # AGENT ACTIVITY
    # --------------------------------------------------

    def _add_activity(
        self,
        activity_type: str,
        message: str
    ) -> None:

        self.agent_activity.append({
            "type": activity_type,
            "message": message
        })

    def get_agent_activity(self) -> list:
        return self.agent_activity

    # --------------------------------------------------
    # BUILD DOCUMENT INDEX
    # --------------------------------------------------

    def build_index(
        self,
        uploaded_files: Iterable
    ) -> dict:

        result = build_document_index(
            uploaded_files=uploaded_files,
            embedding_model=self.embedding_model,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            top_k=self.top_k,
        )

        self.documents = result["documents"]
        self.chunks = result["chunks"]

        self.vector_stores = result[
            "vector_stores"
        ]
  
        self.retrievers = result[
            "retrievers"
        ]

        self.document_map = result[
            "document_map"
        ]

        self.last_retrieved_docs = []
        self.agent_activity = []

        self._load_current_chat_history()

        return {
            "documents": len(
                result["document_ids"]
            ),
            "chunks": len(
                self.chunks
            ),
            "embedding_dimension": result[
                "embedding_dimension"
            ],
            "embedding_model": EMBEDDING_MODEL,
            "llm_model": GROQ_MODEL,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "top_k": self.top_k,
            "document_names": list(
                self.document_map.values()
            ),
            "document_ids": result[
                "document_ids"
            ],
            "document_map": self.document_map,
        }

    def add_documents(
        self,
        uploaded_files: Iterable,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
        top_k: int | None = None,
    ) -> dict:

        if chunk_size is not None:
            self.chunk_size = chunk_size

        if chunk_overlap is not None:
            self.chunk_overlap = chunk_overlap

        if top_k is not None:
            self.top_k = top_k

        new_files = []
        skipped_names = []

        for uploaded_file in uploaded_files:

            content_hash = hashlib.sha256(
                uploaded_file.getvalue()
            ).hexdigest()

            existing = self.db.get_document_by_hash(
                content_hash,
                self.user_id
            )

            if existing is not None:

                skipped_names.append(
                    uploaded_file.name
                )

            else:

                new_files.append(
                    uploaded_file
                )

        if not new_files:

            return {
                "documents": 0,
                "chunks": 0,
                "embedding_dimension": "-",
                "embedding_model": EMBEDDING_MODEL,
                "llm_model": GROQ_MODEL,
                "chunk_size": self.chunk_size,
                "chunk_overlap": self.chunk_overlap,
                "top_k": self.top_k,
                "document_names": [],
                "document_ids": [],
                "document_map": self.document_map,
                "skipped_duplicates": skipped_names,
            }

        result = build_document_index(
            uploaded_files=new_files,
            embedding_model=self.embedding_model,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            top_k=self.top_k,
        )

        self.documents.extend(result["documents"])
        self.chunks.extend(result["chunks"])
        self.vector_stores.update(result["vector_stores"])
        self.retrievers.update(result["retrievers"])
        self.document_map.update(result["document_map"])

        for document_id in result["document_ids"]:

            self.db.add_document(
                document_id=document_id,
                user_id=self.user_id,
                name=result["document_map"][document_id],
                collection_name=result["collection_names"][document_id],
                content_hash=result["content_hashes"][document_id],
                chunk_size=self.chunk_size,
                chunk_overlap=self.chunk_overlap,
                top_k=self.top_k,
            )

        self.last_retrieved_docs = []
        self.agent_activity = []

        self._load_current_chat_history()

        return {
            "documents": len(result["document_ids"]),
            "chunks": len(result["chunks"]),
            "embedding_dimension": result["embedding_dimension"],
            "embedding_model": EMBEDDING_MODEL,
            "llm_model": GROQ_MODEL,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "top_k": self.top_k,
            "document_names": list(result["document_map"].values()),
            "document_ids": result["document_ids"],
            "document_map": self.document_map,
            "skipped_duplicates": skipped_names,
        }

    def remove_document(self, document_id: str) -> dict:

        if document_id not in self.document_map:
            raise ValueError("Document does not exist")

        # Archive every chat that referenced this document BEFORE
        # removing it, so we can report how many were affected.
        archived_count = self.db.archive_conversations_using_document(
            document_id,
            user_id=self.user_id
        )

        # Remove from Chroma.
        vector_store = self.vector_stores.pop(document_id, None)

        if vector_store is not None:
            vector_store.delete_collection()

        self.retrievers.pop(document_id, None)
        self.document_map.pop(document_id, None)

        # Clean up in-memory document / chunk lists.
        self.documents = [
            d for d in self.documents
            if d.metadata.get("document_id") != document_id
        ]
        self.chunks = [
            c for c in self.chunks
            if c.metadata.get("document_id") != document_id
        ]

        # Remove from the DB.
        self.db.delete_document(document_id)

        # Reload chats so the UI sees the archived flags.
        self.chats = self._load_chats()

        return {
            "archived_chats": archived_count,
        }
        
    def delete_user_chroma_collections(self):
        """
        Delete all Chroma collections belonging to this user.
        Called before wiping user data from SQL.
        Returns the count of collections removed.
        """

        from database import Database
        db = Database()
        rows = db.get_documents(self.user_id)

        removed = 0
        for row in rows:
            document_id = row[0]
            vector_store = self.vector_stores.get(document_id)
            if vector_store is not None:
                try:
                    vector_store.delete_collection()
                    removed += 1
                except Exception:
                    pass

        return removed

    # --------------------------------------------------
    # RUN AGENT
    # --------------------------------------------------

    def _run_agent(
        self,
        question: str,
        document_ids: list[str] | None = None,
        temperature: float | None = None,
    ) -> str:

        self.agent_activity = []
        self.last_retrieved_docs = []

        # Phase 5:
        # Only recent messages are sent to the LLM.
        llm_history = self._get_llm_history()

        active_retrievers, active_document_map = (
            self._filter_documents(
                document_ids
            )
        )

        agent = AgentService(
            llm=self.llm,
            retrievers=active_retrievers,
            chats=self.chats,
            current_chat_id=self.current_chat_id,
            activity_callback=self._add_activity,
            retrieved_docs=self.last_retrieved_docs,
            document_map=active_document_map,
            top_k=self.top_k,
            memory_store=self.memory_store
        )

        answer = agent.run(
            question=question,
            chat_history=llm_history,
            temperature=temperature,
        )

        return answer

    def _filter_documents(
        self,
        document_ids: list[str] | None
    ) -> tuple[dict, dict]:

        if not document_ids:

            return self.retrievers, self.document_map

        valid_ids = [
            document_id
            for document_id in document_ids
            if document_id in self.retrievers
        ]

        if not valid_ids:

            return self.retrievers, self.document_map

        filtered_retrievers = {
            document_id: self.retrievers[document_id]
            for document_id in valid_ids
        }

        filtered_document_map = {
            document_id: self.document_map[document_id]
            for document_id in valid_ids
        }

        return filtered_retrievers, filtered_document_map
    

    # --------------------------------------------------
    # ASK
    # --------------------------------------------------

    def ask(
        self,
        question: str,
        document_ids: list[str] | None = None
    ) -> tuple[str, list[Document]]:

        question = question.strip()

        if not question:

            raise RuntimeError(
                "Question cannot be empty."
            )

        if not self.retrievers:

            is_small_talk = AgentService._is_small_talk(
                question
            )

            is_memory_question = AgentService._is_memory_question(
                question
            )

            if (
                not is_small_talk
                and not is_memory_question
            ):

                raise RuntimeError(
                    "Please process your documents before asking a document question"
                )
                

        answer = self._run_agent(
            question,
            document_ids=document_ids
        )

        answer = redact_pii(answer)

        retrieved_docs = (
            self.last_retrieved_docs
        )

        activity = [
            dict(item)
            for item in self.agent_activity
        ]

        # Keep the COMPLETE conversation history
        # in memory for application storage.
        self.chat_history.extend([
            HumanMessage(
                content=question
            ),
            AIMessage(
                content=answer
            ),
        ])

        sources = []
        seen = set()

        for document in retrieved_docs:

            document_id = document.metadata.get(
                "document_id",
                "Unknown"
            )

            source = document.metadata.get(
                "source",
                "Unknown"
            )

            page = document.metadata.get(
                "page",
                "?"
            )

            key = (
                document_id,
                page
            )

            if key not in seen:

                seen.add(key)

                sources.append({
                    "document_id": document_id,
                    "source": source,
                    "page": page,
                    "relevance_score": document.metadata.get("relevance_score"),
                })

        self._save_current_message(
            role="user",
            content=question,
        )

        self._save_current_message(
            role="assistant",
            content=answer,
            sources=sources,
            activity=activity,
        )

        return answer, retrieved_docs
    
    def ask_stream(
        self,
        question: str,
        document_ids: list[str] | None = None,
        temperature: float | None = None,
        image_data: str | None = None,
    ):
        question = question.strip()

        if not question:
            raise RuntimeError("Question cannot be empty.")

        if not self.retrievers:

            is_small_talk = AgentService._is_small_talk(question)
            is_memory_question = AgentService._is_memory_question(question)

            if not is_small_talk and not is_memory_question:
                raise RuntimeError("Please process your documents before asking a document question")

        self.agent_activity = []
        self.last_retrieved_docs = []

        llm_history = self._get_llm_history()

        active_retrievers, active_document_map = self._filter_documents(document_ids)

        agent = AgentService(
            llm=self.llm,
            retrievers=active_retrievers,
            chats=self.chats,
            current_chat_id=self.current_chat_id,
            activity_callback=self._add_activity,
            retrieved_docs=self.last_retrieved_docs,
            document_map=active_document_map,
            top_k=self.top_k,
            memory_store=self.memory_store
        )

        full_answer = ""

        for event in agent.run_stream(
            question,
            chat_history=llm_history,
            temperature=temperature,
        ):

            if event["type"] == "token":

                full_answer += event["text"]

                # Yield the raw token so the UI sees it live.
                # We redact only the final saved answer below, so
                # streaming stays unblocked and PII masking happens
                # on the persisted content.

                yield event

            else:

                yield event

        # Redact PII in the final answer.
        full_answer = redact_pii(full_answer)

        retrieved_docs = self.last_retrieved_docs

        activity = [dict(item) for item in self.agent_activity]

        if temperature is None:
            self.chat_history.extend([
                HumanMessage(content=question),
                AIMessage(content=full_answer),
            ])
        else:
            # Regenerate: only the last AI message changes.
            if self.chat_history and isinstance(self.chat_history[-1], AIMessage):
                self.chat_history[-1] = AIMessage(content=full_answer)

        sources = []
        seen = set()

        for document in retrieved_docs:

            document_id = document.metadata.get("document_id", "Unknown")
            source = document.metadata.get("source", "Unknown")
            page = document.metadata.get("page", "?")
            relevance_score = document.metadata.get("relevance_score")

            key = (document_id, page)

            if key not in seen:
                seen.add(key)
                sources.append({
                    "document_id": document_id,
                    "source": source,
                    "page": page,
                    "relevance_score": relevance_score,
                })

        # On regenerate, skip saving the user message — it's already in the DB.
        # Just replace the assistant answer.
        if temperature is None:
            self._save_current_message(role="user", content=question, image_data=image_data)
            self._save_current_message(role="assistant", content=full_answer, sources=sources, activity=activity)

            # Auto-generate chat title if this is the first message in the chat.
            user_msg_count = sum(
                1
                for m in self.chats.get(self.current_chat_id, {}).get("messages", [])
                if m.get("role") == "user"
            )
            if user_msg_count <= 1:
                new_title = self._generate_and_save_title(
                    self.current_chat_id, question
                )
                if new_title:
                    yield {
                        "type": "title",
                        "chat_id": self.current_chat_id,
                        "name": new_title,
                    }

        else:
            # Regenerate path: replace the LAST assistant message in the DB
            # instead of appending a new one.
            self._replace_last_assistant_message(
                content=full_answer,
                sources=sources,
                activity=activity,
            )
        yield {"type": "saved", "sources": sources}
    