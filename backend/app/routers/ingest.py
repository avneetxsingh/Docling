import os
from fastapi import APIRouter, UploadFile, File
from fastapi import HTTPException
from ..ingest import UPLOADS_DIR, ingest_pdf_paths

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

@router.post("", summary="Upload PDFs and ingest into the vector store")
async def ingest(files: list[UploadFile] = File(...)):
    saved_paths = []
    for f in files:
        dest = os.path.join(UPLOADS_DIR, f.filename)
        with open(dest, "wb") as out:
            out.write(await f.read())
        saved_paths.append(dest)

    try:
        added = ingest_pdf_paths(saved_paths)
    except Exception as exc:
        msg = str(exc)
        if "insufficient_quota" in msg or "RateLimitError" in msg:
            raise HTTPException(
                status_code=429,
                detail=(
                    "OpenAI quota exceeded while generating embeddings. "
                    "Add billing/credits or use a key with available quota."
                ),
            ) from exc
        if "api key" in msg.lower() or "authentication" in msg.lower():
            raise HTTPException(
                status_code=401,
                detail="OpenAI authentication failed. Check OPENAI_API_KEY in .env.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=f"Ingest failed: {msg}",
        ) from exc

    return {"added_documents": added, "files": [os.path.basename(p) for p in saved_paths]}
