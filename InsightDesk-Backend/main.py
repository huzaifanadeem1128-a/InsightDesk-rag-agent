import os
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.openapi.utils import get_openapi
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse


from routes.chat import router as chat_router
from routes.conversations import router as conversations_router
from routes.documents import router as documents_router
from routes.status import router as status_router
from routes.auth import router as auth_router
from routes.admin import router as admin_router

from pathlib import Path






app = FastAPI(
    title="InsightDesk API",
    description="Backend API for the InsightDesk RAG system",
    version="1.0.0"
)

@app.get("/health")
def health_check():
    return {"ok": True}

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Return a generic error message for unhandled exceptions."""
    print(f"[UNHANDLED] {type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred."},
    )

def custom_openapi():

    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes
    )

    request_schema = (
        openapi_schema["paths"]
        ["/documents"]["post"]
        ["requestBody"]
        ["content"]
        ["multipart/form-data"]
        ["schema"]
    )

    if "$ref" in request_schema:

        reference = request_schema["$ref"]

        schema_name = reference.split("/")[-1]

        request_schema = (
            openapi_schema["components"]
            ["schemas"]
            [schema_name]
        )

    files_schema = request_schema["properties"]["files"]

    files_schema["type"] = "array"

    files_schema["items"] = {
        "type": "string",
        "format": "binary"
    }

    app.openapi_schema = openapi_schema

    return app.openapi_schema


app.openapi = custom_openapi


# ============================================================
# API ROUTERS
# ============================================================

app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(documents_router)
app.include_router(status_router)
app.include_router(auth_router)
app.include_router(admin_router)





# ============================================================
# FRONTEND (static files + SPA fallback)
# ============================================================
# Must be mounted LAST so it doesn't shadow API routes.
# Serves index.html for any non-API path so React Router works
# even on hard refresh.

# ============================================================
# FRONTEND (optional — skipped when serving API-only)
# ============================================================
# In production (Docker), the built frontend lives at ../frontend/dist.
# If it doesn't exist (API-only container), we skip frontend routes
# entirely and FastAPI serves just the API.

FRONTEND_DIR = Path(
    os.getenv("FRONTEND_DIST", "../InsightDesk-Frontend/dist")
)
STATIC_DIR = FRONTEND_DIR / "assets"

if FRONTEND_DIR.exists() and (FRONTEND_DIR / "index.html").exists():

    # Serve built assets (js/css) directly.
    if STATIC_DIR.exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(STATIC_DIR)),
            name="assets",
        )

    # SPA fallback: any GET request that isn't /auth, /chat, /chats,
    # /documents, /admin, /rag, or /messages returns index.html.
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        api_prefixes = (
            "auth", "chat", "chats", "documents",
            "admin", "rag", "messages",
        )
        first_segment = full_path.split("/", 1)[0]
        if first_segment in api_prefixes:
            raise HTTPException(status_code=404, detail="Not Found")

        requested_file = FRONTEND_DIR / full_path
        if full_path and requested_file.is_file():
            return FileResponse(requested_file)

        index_file = FRONTEND_DIR / "index.html"
        return FileResponse(index_file)

else:
    print(
        f"[WARN] Frontend dist not found at {FRONTEND_DIR.resolve()} "
        f"— serving API only."
    )


