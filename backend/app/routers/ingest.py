import os
import json
import re
from fastapi import APIRouter, UploadFile, File, Header
from fastapi import HTTPException
from langchain_groq import ChatGroq
from ..ingest import UPLOADS_DIR, ingest_pdf_paths
from ..core.config import settings
from ..vectorstores.store import get_store_wrapper, get_embeddings

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

BRIEF_PROMPT = """You are given excerpts from a document. Return a JSON object with exactly two keys:
- "summary": 2-3 sentence overview of what this document is about
- "questions": array of exactly 5 specific, interesting questions someone would want to ask about it

Respond with raw JSON only, no markdown fences."""


def _generate_brief(filename: str, groq_key: str) -> dict:
    try:
        embeddings = get_embeddings()
        wrapper = get_store_wrapper(embeddings)
        store = wrapper.load()
        docs = store.similarity_search(filename, k=8, filter={"filename": filename})
        if not docs:
            docs = store.similarity_search("summary overview", k=8)
        # filter to this file
        docs = [d for d in docs if (d.metadata or {}).get("filename") == filename][:6]
        context = "\n\n".join(d.page_content for d in docs) if docs else ""
        if not context:
            return {"summary": "", "questions": []}

        llm = ChatGroq(model=settings.GROQ_MODEL, api_key=groq_key, temperature=0.3)
        result = llm.invoke(
            f"{BRIEF_PROMPT}\n\nDOCUMENT EXCERPTS:\n{context}"
        )
        raw = (result.content or "").strip()
        # strip markdown fences if model ignores instruction
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        return json.loads(raw)
    except Exception:
        return {"summary": "", "questions": []}


@router.post("", summary="Upload PDFs and ingest into the vector store")
async def ingest(
    files: list[UploadFile] = File(...),
    x_groq_api_key: str | None = Header(default=None),
):
    saved_paths = []
    for f in files:
        dest = os.path.join(UPLOADS_DIR, f.filename)
        with open(dest, "wb") as out:
            out.write(await f.read())
        saved_paths.append(dest)

    try:
        added = ingest_pdf_paths(saved_paths)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Ingest failed: {exc}") from exc

    filenames = [os.path.basename(p) for p in saved_paths]

    # Generate brief for each uploaded file (best-effort, never fails the request)
    briefs: dict[str, dict] = {}
    groq_key = (x_groq_api_key or "").strip() or (settings.GROQ_API_KEY or "").strip()
    if groq_key:
        for fname in filenames:
            briefs[fname] = _generate_brief(fname, groq_key)

    return {"added_documents": added, "files": filenames, "briefs": briefs}
