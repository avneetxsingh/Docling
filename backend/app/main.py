from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import cors_origins_list, settings
from app.routers import ingest as ingest_router
from app.routers import chat as chat_router
from app.routers import docs as docs_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load the embedding model so the first upload doesn't hang.
    print(f"Loading embedding model '{settings.EMBEDDING_MODEL}'... (downloads ~50MB on first run)")
    from app.vectorstores.store import get_embeddings
    get_embeddings()
    print("Embedding model ready.")
    yield

app = FastAPI(title="RAG PDF Chatbot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Routers
app.include_router(ingest_router.router)
app.include_router(chat_router.router)
app.include_router(docs_router.router)

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/stats")
def stats():
    # very light stats for now (extend later if you want)
    return {"vector_db": settings.VECTOR_DB, "embedding_model": settings.EMBEDDING_MODEL, "chat_model": settings.GROQ_MODEL}
