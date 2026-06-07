import json
import re
import hashlib
from collections import defaultdict
from typing import Optional, List, Dict, Any, Tuple

from fastapi import APIRouter, Header
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.documents import Document

from app.core.config import settings
from app.vectorstores.store import get_store_wrapper, get_embeddings

router = APIRouter(prefix="/api/chat", tags=["chat"])

class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    k: int = 4
    return_debug: bool = False
    filename: Optional[str] = None  # optional per-question scope
    mode: str = "auto"              # "auto" or "cross"
    history: List[ChatTurn] = Field(default_factory=list)
    temperature: float = 0.0


class SuggestRequest(BaseModel):
    question: str
    k: int = 6
    filename: Optional[str] = None
    mode: str = "cross"


class SuggestResponse(BaseModel):
    suggestions: List[str]

class Source(BaseModel):
    page: int
    page_content: str
    metadata: Dict[str, Any]

class ChatResponse(BaseModel):
    answer: str
    sources: List[Source]
    debug_context: Optional[str] = None

SYSTEM_PROMPT = """You are a helpful AI assistant — like ChatGPT, but with access to the user's uploaded documents.

How to behave:
- Answer ANY question the user asks, whether it's about their documents or anything else.
- When the CONTEXT is relevant to the question, use it to give a grounded, accurate answer.
- When the CONTEXT is not relevant, just answer from your own knowledge — don't mention the documents at all.
- Be conversational, concise, and natural. No bullet points unless the user asks for a list.
- Never append page citations like [p=1] in your replies."""

persona_template = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    (
        "human",
        "Conversation so far:\n{history}\n\n"
        "CONTEXT from uploaded documents (use when relevant):\n{context}\n\n"
        "{question}",
    ),
])

suggest_template = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are helping someone have a conversation with a person based on their document. "
        "Suggest natural follow-up questions a human would ask in this conversation. "
        "Keep each question short and conversational. "
        "Return only plain lines, one question per line, no numbering.",
    ),
    (
        "human",
        "Last message: {question}\n\n"
        "CONTEXT:\n{context}\n\n"
        "Generate 4 follow-up questions.",
    ),
])

def _get_store():
    embeddings = get_embeddings()
    wrapper = get_store_wrapper(embeddings)
    return wrapper.load()


def _history_to_text(history: List[ChatTurn]) -> str:
    if not history:
        return "(none)"
    clipped = history[-6:]
    return "\n".join(f"{h.role}: {h.content}" for h in clipped if h.content.strip()) or "(none)"

def _retrieval(store, question: str, kind: str, k: int) -> List[Document]:
    # Prefer MMR to reduce redundancy
    if hasattr(store, "max_marginal_relevance_search"):
        fetch_k = max(8, k * 4) if kind == "summary" else max(6, k * 3)
        return store.max_marginal_relevance_search(
            question, k=k, fetch_k=fetch_k, lambda_mult=0.3
        )
    retriever = store.as_retriever(
        search_type="mmr",
        search_kwargs={
            "k": k,
            "fetch_k": max(8, k * 4) if kind == "summary" else max(6, k * 3),
            "lambda_mult": 0.3
        }
    )
    return retriever.get_relevant_documents(question)


def _stream_chunk_to_text(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                txt = item.get("text")
                if isinstance(txt, str):
                    parts.append(txt)
        return "".join(parts)
    return ""


def _sse(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=True)}\n\n"

def _hash_key(doc: Document) -> str:
    page = int((doc.metadata or {}).get("page", 0))
    text = (doc.page_content or "").strip()
    return hashlib.sha1(f"{page}|{text}".encode("utf-8")).hexdigest()

def _dedupe(docs: List[Document]) -> List[Document]:
    seen = set()
    out: List[Document] = []
    for d in docs:
        text = (d.page_content or "").strip()
        if not text:
            continue
        key = _hash_key(d)
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out

def _format_context(docs: List[Document], include_filename: bool = False) -> Tuple[str, List[Source]]:
    blocks = []
    srcs: List[Source] = []
    for d in docs:
        text = (d.page_content or "").strip()
        if not text:
            continue
        page0 = int((d.metadata or {}).get("page", 0))
        page1 = page0 + 1
        fname = (d.metadata or {}).get("filename") or (d.metadata or {}).get("source") or "document"
        if include_filename:
            blocks.append(f"[{fname}, p={page1}] {text}")
        else:
            blocks.append(f"[p={page1}] {text}")
        md = dict(d.metadata or {})
        md["filename"] = fname
        srcs.append(Source(page=page1, page_content=text, metadata=md))
    return ("\n\n".join(blocks) if blocks else "(no context found)"), srcs

# ---------- file auto-scope ----------
def _best_filename_by_grouping(docs: List[Document]) -> Optional[str]:
    """
    Group retrieved docs by filename and score each group by inverse-rank (1/(rank+1)).
    Pick the filename with the highest total. Works even without similarity scores.
    """
    if not docs:
        return None
    scores: Dict[str, float] = defaultdict(float)
    for rank, d in enumerate(docs):
        fname = (d.metadata or {}).get("filename") or (d.metadata or {}).get("source") or "document"
        scores[fname] += 1.0 / (rank + 1.0)
    best = max(scores.items(), key=lambda kv: kv[1])[0]
    return best
# --------------------------------------------------------


def _prepare_chat(req: ChatRequest) -> Dict[str, Any]:
    k = req.k if req.k else 6

    store = _get_store()
    docs = _retrieval(store, req.question, "summary", k)

    mode = (req.mode or "auto").lower().strip()
    if req.filename:
        want = req.filename.strip().lower()
        docs = [d for d in docs if ((d.metadata or {}).get("filename", "").strip().lower() == want)]
    else:
        if mode == "auto":
            best = _best_filename_by_grouping(docs)
            if best:
                docs = [d for d in docs if ((d.metadata or {}).get("filename") == best)]

    docs = _dedupe(docs)
    include_filename = (mode == "cross" and not req.filename)
    context, sources = _format_context(docs, include_filename=include_filename)

    messages = persona_template.format_messages(
        question=req.question,
        context=context,
        history=_history_to_text(req.history),
    )

    return {
        "context": context,
        "sources": sources,
        "messages": messages,
    }


def _resolve_key(header_key: str | None) -> str:
    key = (header_key or "").strip() or (settings.GROQ_API_KEY or "").strip()
    if not key:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY is missing. Enter your free key from console.groq.com in the UI.",
        )
    return key

@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, x_groq_api_key: str | None = Header(default=None)):
    key = _resolve_key(x_groq_api_key)
    prepared = _prepare_chat(req)
    context = prepared["context"]
    sources = prepared["sources"]

    llm = ChatGroq(model=settings.GROQ_MODEL, api_key=key, temperature=req.temperature)
    try:
        result = llm.invoke(prepared["messages"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}") from exc

    return ChatResponse(answer=result.content, sources=sources, debug_context=context if req.return_debug else None)


@router.post("/stream")
async def chat_stream(req: ChatRequest, x_groq_api_key: str | None = Header(default=None)):
    key = _resolve_key(x_groq_api_key)
    prepared = _prepare_chat(req)
    context = prepared["context"]
    sources = prepared["sources"]

    async def event_gen():
        yield _sse({
            "type": "meta",
            "sources": [s.model_dump() for s in sources],
            "debug_context": context if req.return_debug else None,
        })

        llm = ChatGroq(model=settings.GROQ_MODEL, api_key=key, temperature=req.temperature)
        parts: List[str] = []
        try:
            for chunk in llm.stream(prepared["messages"]):
                text = _stream_chunk_to_text(chunk)
                if not text:
                    continue
                parts.append(text)
                yield _sse({"type": "token", "token": text})
        except Exception as exc:
            yield _sse({"type": "done", "answer": f"LLM request failed: {exc}"})
            return

        answer = "".join(parts).strip() or "I don't know."
        yield _sse({"type": "done", "answer": answer})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/suggest", response_model=SuggestResponse)
async def suggest(req: SuggestRequest, x_groq_api_key: str | None = Header(default=None)):
    key = _resolve_key(x_groq_api_key)
    prep_req = ChatRequest(
        question=req.question,
        k=req.k,
        filename=req.filename,
        mode=req.mode,
    )
    prepared = _prepare_chat(prep_req)
    context = prepared["context"]
    if context == "(no context found)":
        return SuggestResponse(suggestions=[])

    llm = ChatGroq(model=settings.GROQ_MODEL, api_key=key, temperature=0.2)
    msgs = suggest_template.format_messages(question=req.question, context=context)
    try:
        raw = llm.invoke(msgs).content or ""
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Suggestion generation failed: {exc}") from exc

    suggestions: List[str] = []
    for line in raw.splitlines():
        cleaned = re.sub(r"^[\-\*\d\.)\s]+", "", line).strip()
        if cleaned and cleaned not in suggestions:
            suggestions.append(cleaned)

    return SuggestResponse(suggestions=suggestions[:4])
