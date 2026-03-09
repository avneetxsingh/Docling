import { useState } from "react";
import { uploadPdfs } from "../lib/api";

type Props = {
  onIngest?: (resp: { added_documents: number; files: string[] }) => void;
};

export default function Upload({ onIngest }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleFiles = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const fl = ev.target.files;
    if (!fl || fl.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const files = Array.from(fl);
      const res = await uploadPdfs(files);
      setMsg(`Ingested ${res.added_documents} chunks from ${res.files.join(", ")}`);
      onIngest?.(res);
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      ev.target.value = "";
    }
  };

  return (
    <div>
      <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[var(--brand)] text-white cursor-pointer shadow-sm hover:brightness-95 transition">
        <input type="file" accept="application/pdf" multiple onChange={handleFiles} className="hidden" />
        {busy ? "Uploading..." : "Choose PDFs"}
      </label>
      {msg && <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">{msg}</p>}
    </div>
  );
}
