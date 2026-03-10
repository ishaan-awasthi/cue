"use client";

import { useCallback, useState } from "react";
import { uploadFile } from "../lib/api";
import type { UploadedFile } from "../lib/supabase";

interface Props {
  onUploaded: (file: UploadedFile) => void;
}

const ACCEPTED_TYPES = ".pdf,.pptx,.docx,.txt,.md";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function FileUploader({ onUploaded }: Props) {
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED_TYPES.includes(ext)) {
        setState("error");
        setErrorMsg(`Unsupported file type: ${ext}. Accepted: ${ACCEPTED_TYPES}`);
        return;
      }
      setState("uploading");
      setErrorMsg("");
      try {
        const result = await uploadFile(file);
        setUploadedFile(result);
        setState("success");
        onUploaded(result);
      } catch (err) {
        setState("error");
        setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [onUploaded]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      style={{
        border: `2px dashed ${isDragging ? "var(--aqua)" : state === "error" ? "rgba(248,113,113,0.3)" : state === "success" ? "rgba(45,255,192,0.3)" : "rgba(45,255,192,0.12)"}`,
        borderRadius: "12px",
        padding: "32px",
        textAlign: "center",
        background: isDragging ? "rgba(45,255,192,0.06)" : state === "success" ? "rgba(45,255,192,0.03)" : "rgba(240,245,243,0.02)",
        transition: "border-color 0.2s, background 0.2s",
      }}
    >
      {state === "idle" && (
        <>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.5)" }}>
            Drag & drop a file, or{" "}
            <label style={{ color: "var(--aqua)", textDecoration: "underline", cursor: "pointer" }}>
              browse
              <input type="file" accept={ACCEPTED_TYPES} style={{ display: "none" }} onChange={onInputChange} />
            </label>
          </p>
          <p style={{ marginTop: "6px", fontSize: "0.75rem", color: "rgba(240,245,243,0.3)" }}>PDF · PPTX · DOCX · TXT · MD</p>
        </>
      )}

      {state === "uploading" && (
        <div className="flex flex-col items-center" style={{ gap: "8px" }}>
          <div style={{ width: "20px", height: "20px", border: "2px solid var(--aqua)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: "0.875rem", color: "var(--aqua)" }}>Uploading & indexing…</p>
        </div>
      )}

      {state === "success" && uploadedFile && (
        <div className="flex flex-col items-center" style={{ gap: "4px" }}>
          <p style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--aqua)" }}>Uploaded</p>
          <p style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.4)" }}>
            {uploadedFile.filename} — {uploadedFile.chunk_count} chunks indexed
          </p>
          <button onClick={() => setState("idle")} style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--aqua)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
            Upload another
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center" style={{ gap: "4px" }}>
          <p style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--fg)" }}>Upload failed</p>
          <p style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.4)" }}>{errorMsg}</p>
          <button onClick={() => setState("idle")} style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--aqua)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
