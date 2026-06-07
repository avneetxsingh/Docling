from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # Groq (free) — get a key at console.groq.com
    GROQ_API_KEY: str | None = None
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # Local HuggingFace embeddings — no API key needed
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    VECTOR_DB: str = "faiss"  # or "pinecone"

    # Pinecone
    PINECONE_API_KEY: str | None = None
    PINECONE_INDEX: str | None = None
    PINECONE_CLOUD: str | None = None
    PINECONE_REGION: str | None = None

    CORS_ORIGINS: str = "http://localhost:5173"

    class Config:
        env_file = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")

settings = Settings()

def cors_origins_list() -> List[str]:
    return [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
