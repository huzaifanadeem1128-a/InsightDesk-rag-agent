# InsightDesk — Backend

FastAPI backend for **InsightDesk**, an AI-powered document Q&A workspace with conversation memory and multi-user support.

## What it does

- **Retrieval-Augmented Generation (RAG)** over user-uploaded PDFs and TXT documents
- **Multi-user accounts** with sessions, password reset, and account deletion
- **Agentic pipeline** using Groq (GPT-OSS) with a smaller model for lightweight tasks
- **Chroma vector store** with HuggingFace `sentence-transformers` embeddings
- **Streaming responses** via Server-Sent Events (SSE)
- **Voice + vision**: Whisper transcription, Qwen image OCR
- **Admin panel**: user management, RAG health metrics, audit log
- **Guardrails**: input filtering and PII redaction

## Tech stack

| Layer | Tech |
|---|---|
| Web framework | FastAPI + Uvicorn |
| LLM | Groq — `openai/gpt-oss-120b`, `openai/gpt-oss-20b` |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` |
| Vector store | Chroma (persisted to `./chroma_db/`) |
| RDBMS | SQLite (`Database.db`) |
| Auth | Passlib + bcrypt, session tokens in DB |
| Email | Resend (password reset) |
| PDF export | ReportLab |
| Voice | Groq Whisper (`whisper-large-v3-turbo`) |
| Vision | Qwen on Groq |

## Setup

### 1. Clone and create a virtualenv

```bash
python3.11 -m venv .venv
source .venv/bin/activate

