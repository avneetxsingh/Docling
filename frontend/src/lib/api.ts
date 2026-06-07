const rawBase = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8001";
const API_BASE = String(rawBase).replace(/\/$/, "");

export const KEY_STORAGE = "groq_api_key";

export function getStoredKey(): string {
  return localStorage.getItem(KEY_STORAGE) || "";
}

export function saveKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

function authHeaders(): Record<string, string> {
  const key = getStoredKey();
  return key ? { "X-Groq-API-Key": key } : {};
}

async function parseError(res: Response): Promise<string> {
  const fallback = `${res.status} ${res.statusText}`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
    return JSON.stringify(data);
  } catch {
    try {
      const text = await res.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

export type ChatSource = {
  page: number;
  page_content: string;
  metadata: Record<string, any>;
};
export type ChatResponse = {
  answer: string;
  sources: ChatSource[];
  debug_context?: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AskParams = {
  question: string;
  k?: number;
  filename?: string;
  mode?: "auto" | "cross";
  return_debug?: boolean;
  history?: ChatTurn[];
  temperature?: number;
};

export type StreamMetaEvent = {
  type: "meta";
  sources: ChatSource[];
  debug_context?: string;
};

export type StreamTokenEvent = {
  type: "token";
  token: string;
};

export type StreamDoneEvent = {
  type: "done";
  answer: string;
};

export type StreamEvent = StreamMetaEvent | StreamTokenEvent | StreamDoneEvent;

export type DocStat = {
  filename: string;
  chunks: number;
  pages: number;
};

export type DocsStats = {
  vector_db: string;
  total_documents: number;
  total_chunks: number;
  total_pages: number;
  documents: DocStat[];
};

export type DocBrief = {
  summary: string;
  questions: string[];
};

export async function uploadPdfs(
  files: File[]
): Promise<{ added_documents: number; files: string[]; briefs: Record<string, DocBrief> }> {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const res = await fetch(`${API_BASE}/api/ingest`, { method: "POST", headers: authHeaders(), body: fd });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

/**
 * Ask the backend a question.
 * @param question user question
 * @param k top-k retrieval
 * @param filename optional filename to hard-scope the query
 * @param mode "auto" (one best doc) or "cross" (compare across docs)
 * @param return_debug include debug_context
 */
export async function ask(
  question: string,
  k = 4,
  filename?: string,
  mode: "auto" | "cross" = "auto",
  return_debug = false,
  history: ChatTurn[] = []
): Promise<ChatResponse> {
  const body: any = { question, k, mode, history };
  if (filename) body.filename = filename;
  if (return_debug) body.return_debug = true;

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function askStream(
  params: AskParams,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const body: any = {
    question: params.question,
    k: params.k ?? 4,
    mode: params.mode ?? "auto",
    history: params.history ?? [],
    return_debug: params.return_debug ?? false,
    temperature: params.temperature ?? 0,
  };
  if (params.filename) body.filename = params.filename;

  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await parseError(res));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      const dataLine = eventBlock
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = dataLine.replace(/^data:\s*/, "");
      if (!payload) continue;
      onEvent(JSON.parse(payload) as StreamEvent);
    }
  }
}

export async function getDocsStats(): Promise<DocsStats> {
  const res = await fetch(`${API_BASE}/api/docs`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function clearDocs(clearUploads = false): Promise<{ removed_index: boolean; removed_uploads: number }> {
  const res = await fetch(`${API_BASE}/api/docs?clear_uploads=${clearUploads ? "true" : "false"}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function suggestQuestions(
  question: string,
  filename?: string,
  mode: "auto" | "cross" = "cross"
): Promise<string[]> {
  const body: any = { question, k: 6, mode };
  if (filename) body.filename = filename;

  const res = await fetch(`${API_BASE}/api/chat/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.suggestions || [];
}
