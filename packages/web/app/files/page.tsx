"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listFiles, deleteFile, type UploadedFile } from "../../lib/api";
import FileUploader from "../../components/FileUploader";

export default function FilesPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listFiles().then(setFiles).catch(() => setFiles([])).finally(() => setLoading(false));
  }, []);

  const handleUploaded = (file: UploadedFile) => setFiles((prev) => [file, ...prev]);

  const handleDelete = async (fileId: string) => {
    if (!confirm("Remove this file and all its indexed chunks?")) return;
    setDeletingId(fileId);
    try {
      await deleteFile(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 16px", background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      <div className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", marginBottom: "24px" }}>
        <Link href="/app" style={{ color: "rgba(240,245,243,0.4)" }}>Sessions</Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <span style={{ color: "rgba(240,245,243,0.6)" }}>Reference files</span>
      </div>

      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, marginBottom: "32px" }}>
        Reference files
      </h1>

      <div className="feature-card" style={{ marginBottom: "32px" }}>
        <p style={{ fontSize: "0.875rem", lineHeight: 1.7, color: "rgba(240,245,243,0.6)" }}>
          <span style={{ color: "var(--aqua)", fontWeight: 700 }}>How this works —</span>{" "}
          Upload your slide deck, speaker notes, or any reference document. During a live session,
          Cue will search these files and whisper a concise answer into your earpiece when an
          audience member asks a question.
        </p>
      </div>

      <div style={{ marginBottom: "32px" }}>
        <FileUploader onUploaded={handleUploaded} />
      </div>

      <section>
        <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>
          Indexed files
        </p>

        {loading && <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>Loading…</p>}

        {!loading && files.length === 0 && (
          <div className="feature-card" style={{ border: "1px dashed rgba(45,255,192,0.15)", padding: "32px", textAlign: "center", fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>
            No files uploaded yet.
          </div>
        )}

        {!loading && files.length > 0 && (
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {files.map((f) => (
              <li key={f.id} className="feature-card" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "12px 16px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</p>
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(240,245,243,0.3)", fontWeight: 600, marginTop: "2px" }}>
                    {f.chunk_count} chunks · {format(new Date(f.uploaded_at), "MMM d, yyyy")}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(f.id)}
                  disabled={deletingId === f.id}
                  style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.3)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, transition: "color 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--aqua)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "rgba(240,245,243,0.3)")}
                >
                  {deletingId === f.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
