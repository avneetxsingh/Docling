import { useEffect, useState } from "react";
import Upload from "./components/Upload";
import Chat from "./components/Chat";
import { clearDocs, getDocsStats, type DocsStats } from "./lib/api";

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | "ALL">("ALL");
  const [stats, setStats] = useState<DocsStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const next = await getDocsStats();
      setStats(next);
      setFiles(next.documents.map((d) => d.filename));
      if (next.documents.length === 0) {
        setSelectedFile("ALL");
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed to load corpus stats");
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleClear = async (clearUploads: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await clearDocs(clearUploads);
      setMsg(
        `Cleared index=${res.removed_index ? "yes" : "no"}, uploads removed=${res.removed_uploads}`
      );
      await loadStats();
    } catch (e: any) {
      setMsg(e?.message || "Failed to clear docs");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-7xl mx-auto fade-up">
        <header className="glass-panel rounded-3xl p-5 md:p-7 mb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Docling AI Workspace</p>
              <h1 className="section-title text-3xl md:text-5xl font-semibold mt-1">Research Copilot</h1>
              <p className="text-sm md:text-base text-[var(--muted)] mt-2">
                Upload PDFs, reason across documents, and chat with source-grounded context.
              </p>
            </div>
            <div className="rounded-2xl px-4 py-3 bg-[var(--brand-soft)] border border-[var(--line)]">
              <p className="text-xs text-[var(--muted)]">Model Flow</p>
              <p className="font-medium text-sm mt-1">Ingest | Embed | Retrieve | Answer</p>
            </div>
          </div>
        </header>

        <div className="grid md:grid-cols-12 gap-5">
          <aside className="md:col-span-4 space-y-5">
            <section className="glass-panel rounded-3xl p-5">
              <h2 className="section-title font-semibold mb-3">Upload PDFs</h2>
            <Upload
              onIngest={async (ingested) => {
                const names = ingested.files;
                if (names.length > 0) setSelectedFile(names[names.length - 1]);
                await loadStats();
              }}
            />
            {!!stats && files.length > 0 && (
              <p className="text-xs text-[var(--muted)] mt-3 leading-relaxed">
                Ingested {files.length} file{files.length > 1 ? "s" : ""}: {files.join(", ")}
              </p>
            )}
            </section>

            <section className="glass-panel rounded-3xl p-5">
              <h2 className="section-title font-semibold mb-3">Corpus Intelligence</h2>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div className="rounded-2xl bg-white/80 p-3 border border-[var(--line)]">
                <p className="text-xs text-[var(--muted)]">Docs</p>
                <p className="text-lg font-semibold">{stats?.total_documents ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-3 border border-[var(--line)]">
                <p className="text-xs text-[var(--muted)]">Chunks</p>
                <p className="text-lg font-semibold">{stats?.total_chunks ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-3 border border-[var(--line)]">
                <p className="text-xs text-[var(--muted)]">Pages</p>
                <p className="text-lg font-semibold">{stats?.total_pages ?? 0}</p>
              </div>
            </div>

              <div className="max-h-48 overflow-y-auto border border-[var(--line)] rounded-2xl p-3 bg-white/70">
              {stats?.documents.length ? (
                <ul className="space-y-1 text-sm">
                  {stats.documents.map((d) => (
                    <li key={d.filename} className="flex items-center justify-between">
                      <span className="truncate mr-2">{d.filename}</span>
                        <span className="text-xs text-[var(--muted)]">{d.pages}p / {d.chunks}c</span>
                    </li>
                  ))}
                </ul>
              ) : (
                  <p className="text-xs text-[var(--muted)]">No indexed documents yet.</p>
              )}
            </div>

              <div className="flex gap-2 mt-3">
              <button
                onClick={() => handleClear(false)}
                disabled={busy}
                  className="px-3 py-2 text-xs rounded-xl border border-[var(--line)] hover:bg-white/70"
              >
                Clear Index
              </button>
              <button
                onClick={() => handleClear(true)}
                disabled={busy}
                  className="px-3 py-2 text-xs rounded-xl text-white bg-[var(--user-bubble)]"
              >
                Clear Index + Uploads
              </button>
            </div>
              {msg && <p className="text-xs text-[var(--muted)] mt-2">{msg}</p>}
            </section>
          </aside>

          <main className="md:col-span-8">
            <section className="glass-panel rounded-3xl p-4 md:p-5 h-full">
            <div className="flex items-center justify-between mb-2">
                <h2 className="section-title font-semibold">Chat</h2>
              <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">Scope:</span>
                <select
                    className="text-sm border border-[var(--line)] rounded-xl px-3 py-1.5 bg-white/85"
                  value={selectedFile}
                  onChange={(e) => setSelectedFile(e.target.value as any)}
                >
                  <option value="ALL">All documents</option>
                  {files.map((f) => (
                      <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
            <Chat filename={selectedFile === "ALL" ? undefined : selectedFile} />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
