from app.core.config import settings
from app.vectorstores.faiss_store import FAISSWrapper, get_embeddings as get_hf_embeddings

# Lazy import to avoid requiring pinecone unless used
def get_store_wrapper(embeddings):
    if (settings.VECTOR_DB or "").lower() == "pinecone":
        from app.vectorstores.pinecone_store import PineconeWrapper
        return PineconeWrapper(embeddings)
    return FAISSWrapper(embeddings)

def get_embeddings():
    return get_hf_embeddings(model=settings.EMBEDDING_MODEL)
