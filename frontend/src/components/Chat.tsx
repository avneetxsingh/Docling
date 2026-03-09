import { useMemo, useState } from "react";
import { ask, askStream, suggestQuestions } from "../lib/api";
import type { ChatResponse, ChatTurn, StreamEvent } from "../lib/api";

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: ChatResponse["sources"];
  debug?: string;
};

export default function Chat({ filename }: { filename?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"auto" | "cross">("auto");
  const [streaming, setStreaming] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const history: ChatTurn[] = useMemo(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const patchAssistant = (id: number, updater: (current: Msg) => Msg) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? updater(msg) : msg)));
  };

  const loadSuggestions = async (question: string) => {
    try {
      const picks = await suggestQuestions(question, filename, mode);
      setSuggestions(picks);
    } catch {
      setSuggestions([]);
    }
  };

  const send = async (override?: string) => {
    const question = (override ?? q).trim();
    if (!question) return;
    setMessages((m) => [...m, { id: Date.now(), role: "user", content: question }]);
    setQ("");
    setSuggestions([]);
    setBusy(true);

    const assistantId = Date.now() + 1;
    setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

    try {
      if (streaming) {
        await askStream(
          {
            question,
            k: 4,
            filename,
            mode,
            return_debug: showDebug,
            history,
          },
          (event: StreamEvent) => {
            if (event.type === "meta") {
              patchAssistant(assistantId, (current) => ({
                ...current,
                sources: event.sources,
                debug: event.debug_context,
              }));
            }
            if (event.type === "token") {
              patchAssistant(assistantId, (current) => ({
                ...current,
                content: `${current.content}${event.token}`,
              }));
            }
            if (event.type === "done") {
              patchAssistant(assistantId, (current) => ({
                ...current,
                content: event.answer || current.content,
              }));
            }
          }
        );
      } else {
        const res = await ask(question, 4, filename, mode, showDebug, history);
        patchAssistant(assistantId, () => ({
          id: assistantId,
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          debug: res.debug_context,
        }));
      }

      await loadSuggestions(question);
    } catch (e: any) {
      patchAssistant(assistantId, () => ({
        id: assistantId,
        role: "assistant",
        content: e?.message || "Error",
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/50 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Agent Controls</span>
        <div className="h-px bg-[var(--line)] flex-1 min-w-12" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-sm text-[var(--muted)]">Mode:</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "auto" | "cross")}
          className="border border-[var(--line)] rounded-xl px-2.5 py-1.5 text-sm bg-white/80"
        >
          <option value="auto">Auto (1 doc)</option>
          <option value="cross">Cross (all docs)</option>
        </select>

        <label className="text-sm inline-flex items-center gap-1 ml-1 text-[var(--muted)]">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => setStreaming(e.target.checked)}
          />
          Streaming
        </label>

        <label className="text-sm inline-flex items-center gap-1 ml-1 text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => setShowDebug(e.target.checked)}
          />
          Debug context
        </label>
      </div>

      {messages.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/65 p-4 mb-4">
          <p className="text-sm text-[var(--muted)]">
            Ask for summaries, comparisons, key findings, or exact quotes from your PDFs.
          </p>
        </div>
      )}

      <div className="space-y-4 max-h-[56vh] overflow-y-auto mb-4 pr-1">
        {messages.map((m, i) => (
          <div key={m.id ?? i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block p-3 rounded-2xl max-w-[92%] md:max-w-[85%] border ${
                m.role === "user"
                  ? "bg-[var(--user-bubble)] text-white border-transparent"
                  : "bg-[var(--assistant-bubble)] border-[var(--line)]"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>

              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  <p className="font-medium mb-1">Sources</p>
                  <ul className="space-y-2">
                    {m.sources.map((s, idx) => (
                      <li key={idx} className="bg-white rounded-xl p-2 border border-[var(--line)]">
                        <p className="font-medium">{s.metadata?.filename ?? "document"} - p={s.page}</p>
                        <p className="mt-1 text-[#324338]">{String(s.page_content).slice(0, 190)}...</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {showDebug && m.role === "assistant" && m.debug && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-[var(--muted)]">Retrieved Context</summary>
                  <pre className="text-xs mt-1 whitespace-pre-wrap bg-white border border-[var(--line)] rounded p-2 max-h-48 overflow-auto">
                    {m.debug}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={`Ask something about ${
            filename ? `"${filename}"` : "your PDFs"
          }…`}
          className="flex-1 border border-[var(--line)] bg-white rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#9ed7bc]"
        />
        <button
          onClick={() => send()}
          disabled={busy}
          className="px-5 py-3 rounded-2xl bg-[var(--brand)] text-white disabled:opacity-50"
        >
          {busy ? "Thinking..." : "Send"}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-[var(--muted)] mb-2">Try next:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="px-3 py-1.5 text-xs rounded-full border border-[var(--line)] bg-white hover:bg-[var(--brand-soft)]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
