import os
import shutil
from collections import defaultdict
from typing import Dict, List, Set

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.config import settings
from app.ingest import UPLOADS_DIR
from app.vectorstores.faiss_store import INDEX_PATH, FAISSWrapper


class _NoopEmbeddings:
    """Embeddings shim for loading FAISS metadata without external API calls."""

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [[0.0] for _ in texts]

    def embed_query(self, text: str) -> List[float]:
        return [0.0]

router = APIRouter(prefix="/api/docs", tags=["docs"])


class DocumentStat(BaseModel):
    filename: str
    chunks: int
    pages: int


class DocsStatsResponse(BaseModel):
    vector_db: str
    total_documents: int
    total_chunks: int
    total_pages: int
    documents: List[DocumentStat]


class ClearDocsResponse(BaseModel):
    removed_index: bool
    removed_uploads: int


def _indexed_docs_stats() -> List[DocumentStat]:
    if (settings.VECTOR_DB or "").lower() != "faiss":
        return []

    embeddings = _NoopEmbeddings()
    wrapper = FAISSWrapper(embeddings)
    if not wrapper.exists():
        return []

    store = wrapper.load()
    raw_docs = getattr(getattr(store, "docstore", None), "_dict", {}) or {}

    chunk_counts: Dict[str, int] = defaultdict(int)
    page_sets: Dict[str, Set[int]] = defaultdict(set)
    for doc in raw_docs.values():
        meta = doc.metadata or {}
        filename = meta.get("filename") or meta.get("source") or "document"
        page0 = int(meta.get("page", -1))
        chunk_counts[filename] += 1
        if page0 >= 0:
            page_sets[filename].add(page0 + 1)

    out: List[DocumentStat] = []
    for filename, chunks in chunk_counts.items():
        out.append(
            DocumentStat(
                filename=filename,
                chunks=chunks,
                pages=len(page_sets.get(filename, set())),
            )
        )
    out.sort(key=lambda d: d.filename.lower())
    return out


@router.get("", response_model=DocsStatsResponse)
def docs_stats():
    docs = _indexed_docs_stats()
    return DocsStatsResponse(
        vector_db=(settings.VECTOR_DB or "faiss").lower(),
        total_documents=len(docs),
        total_chunks=sum(d.chunks for d in docs),
        total_pages=sum(d.pages for d in docs),
        documents=docs,
    )


@router.delete("", response_model=ClearDocsResponse)
def clear_docs(clear_uploads: bool = Query(default=False)):
    removed_index = False
    removed_uploads = 0

    if os.path.isdir(INDEX_PATH):
        shutil.rmtree(INDEX_PATH, ignore_errors=True)
        removed_index = True

    if clear_uploads and os.path.isdir(UPLOADS_DIR):
        for name in os.listdir(UPLOADS_DIR):
            path = os.path.join(UPLOADS_DIR, name)
            if os.path.isfile(path):
                os.remove(path)
                removed_uploads += 1

    return ClearDocsResponse(removed_index=removed_index, removed_uploads=removed_uploads)
