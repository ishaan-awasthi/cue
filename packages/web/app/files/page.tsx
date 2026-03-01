"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listFiles, type UploadedFile } from "../../lib/supabase";
import { deleteFile } from "../../lib/api";
import FileUploader from "../../components/FileUploader";

const USER_ID = process.env.NEXT_PUBLIC_USER_ID ?? "00000000-0000-0000-0000-000000000001";

export default function FilesPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listFiles(USER_ID).then((f) => {
      setFiles(f);
      setLoading(false);
    });
  }, []);

  const handleUploaded = (file: UploadedFile) => {
    setFiles((prev) => [file, ...prev]);
  };

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
    <main className="max-w-2xl mx-auto px-4 py-10 bg-gray-950 text-gray-100 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/app" className="hover:text-aqua transition-colors">Sessions</Link>
            <span>/</span>
            <span className="text-gray-400">Reference Files</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Reference Files</h1>
        </div>
      </div>

      {/* Explanation */}
      <div className="rounded-xl bg-gray-800/50 border border-gray-700 px-5 py-4 text-sm text-gray-300 mb-8">
        <strong className="text-aqua">How this works:</strong> Upload your slide deck, speaker notes, or any reference
        document. During a live session, if an audience member asks a question you pause on, Cue
        will search these files and whisper a concise answer into your earpiece.
      </div>

      {/* Upload */}
      <div className="mb-8">
        <FileUploader onUploaded={handleUploaded} />
      </div>

      {/* File list */}
      <section>
        <h2 className="text-base font-semibold text-gray-300 mb-3">Indexed Files</h2>

        {loading && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {!loading && files.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">
            No files uploaded yet.
          </div>
        )}

        {!loading && files.length > 0 && (
          <ul className="space-y-2">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-4 rounded-lg border border-gray-700 bg-gray-900/50 px-4 py-3"
              >
                {/* Icon */}
                <span className="text-xl shrink-0">
                  {f.file_type === "pdf"
                    ? "📄"
                    : f.file_type === "pptx"
                    ? "📊"
                    : f.file_type === "docx"
                    ? "📝"
                    : "📃"}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">{f.filename}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {f.chunk_count} chunks indexed ·{" "}
                    {format(new Date(f.uploaded_at), "MMM d, yyyy")}
                  </p>
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(f.id)}
                  disabled={deletingId === f.id}
                  className="text-xs text-gray-400 hover:text-aqua disabled:opacity-40 shrink-0 transition-colors"
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
