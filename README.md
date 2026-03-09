# Docling

Production-style, open source RAG workspace for PDF intelligence.

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-Frontend-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

Docling ingests PDFs, builds a local FAISS index, and exposes grounded Q/A, streaming responses, and follow-up suggestion generation through a FastAPI backend and a modern React UI.

## Screenshot

![Docling UI](docs/screenshots/research-copilot.png)

## Why Docling

- End-to-end local RAG workflow with minimal setup
- Source-grounded answers with page-level citations
- Streaming chat and follow-up suggestions for interactive analysis
- Corpus intelligence panel (documents, chunk count, page count)
- File-scoped or cross-document reasoning modes

## Core Features

- `POST /api/ingest` for multi-file PDF ingestion
- `POST /api/chat` for standard answer generation
- `POST /api/chat/stream` for SSE token streaming
- `POST /api/chat/suggest` for context-aware follow-up questions
- `GET /api/docs` and `DELETE /api/docs` for corpus lifecycle control

## Architecture

```text
React (Vite + TypeScript) UI
        |
        | HTTP / SSE
        v
FastAPI API Layer
  - ingest router
  - chat router
  - docs router
        |
        | retrieval + generation orchestration
        v
LangChain + FAISS
  - chunking
  - embeddings
  - vector search (MMR)
        |
        v
OpenAI API (embeddings + chat model)
```

## Tech Stack

- Backend: FastAPI, Uvicorn, Pydantic Settings
- Retrieval: LangChain, FAISS, PyPDF
- Frontend: React, TypeScript, Vite, Tailwind CSS
- Runtime: Python virtualenv + Node.js

## Repository Layout

```text
.
├── backend/
│   ├── app/
│   │   ├── core/            # config and settings
│   │   ├── routers/         # API endpoints
│   │   └── vectorstores/    # FAISS and optional Pinecone wrappers
│   ├── data/uploads/        # uploaded PDF files
│   ├── storage/faiss/index/ # local vector index
│   └── requirements.txt
├── frontend/
│   ├── src/components/
│   ├── src/lib/api.ts
│   └── package.json
└── .env.example
```

## Quick Start

### 1. Clone

```bash
git clone https://github.com/avneetxsingh/docling.git
cd docling
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set at minimum:

```env
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
CHAT_MODEL=gpt-4o-mini
VECTOR_DB=faiss
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### 3. Start backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
source backend/.venv/bin/activate
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001 --reload
```

### 4. Start frontend

```bash
cd frontend
npm install
echo "VITE_BACKEND_URL=http://127.0.0.1:8001" > .env
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`.

## API Surface

- `GET /api/health`: health check
- `POST /api/ingest`: upload and index PDFs
- `POST /api/chat`: standard RAG answer endpoint
- `POST /api/chat/stream`: SSE streaming endpoint
- `POST /api/chat/suggest`: follow-up question suggestions
- `GET /api/docs`: corpus stats
- `DELETE /api/docs?clear_uploads=true|false`: clear corpus state

Interactive API docs:

- `http://127.0.0.1:8001/docs`

## Production Notes

- This project currently depends on OpenAI for embeddings and chat generation.
- If OpenAI credits are exhausted, ingestion/chat will fail with quota errors.
- Backend now surfaces actionable ingest errors (for example `429` quota exhaustion).

## Troubleshooting

- `Address already in use` on backend:

```bash
pkill -f "uvicorn app.main:app" || true
```

- Upload/chat returns quota error:
  - Verify OpenAI billing/credits for the configured key.

- Frontend cannot connect to backend:
  - Ensure `frontend/.env` contains `VITE_BACKEND_URL=http://127.0.0.1:8001`.

## License

MIT. See `LICENSE`.