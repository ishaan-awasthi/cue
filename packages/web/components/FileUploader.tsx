"use client";

import { useCallback, useState } from "react";
import { uploadFile } from "../lib/api";
import type { UploadedFile } from "../lib/supabase";

interface Props {
  onUploaded: (file: UploadedFile) => void;
}

const ACCEPTED_TYPES = ".pdf,.pptx,.docx,.txt,.md";
const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

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
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
        isDragging
          ? "border-aqua bg-aqua/10"
          : state === "error"
          ? "border-gray-500 bg-gray-800/50"
          : state === "success"
          ? "border-aqua/50 bg-aqua/5"
          : "border-gray-600 bg-gray-800/30 hover:border-aqua/50 hover:bg-aqua/5"
      }`}
    >
      {state === "idle" && (
        <>
          <p className="text-gray-400 text-sm">
            Drag &amp; drop a file here, or{" "}
            <label className="text-aqua underline cursor-pointer">
              browse
              <input
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={onInputChange}
              />
            </label>
          </p>
          <p className="mt-1 text-xs text-gray-500">PDF, PPTX, DOCX, TXT, MD</p>
        </>
      )}

      {state === "uploading" && (
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-aqua border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-aqua">Uploading &amp; indexing…</p>
        </div>
      )}

      {state === "success" && uploadedFile && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-aqua font-medium text-sm">✓ Uploaded successfully</p>
          <p className="text-xs text-gray-500">
            {uploadedFile.filename} — {uploadedFile.chunk_count} chunks indexed
          </p>
          <button
            className="mt-2 text-xs text-aqua underline hover:no-underline"
            onClick={() => setState("idle")}
          >
            Upload another
          </button>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-gray-300 font-medium text-sm">Upload failed</p>
          <p className="text-xs text-gray-500">{errorMsg}</p>
          <button
            className="mt-2 text-xs text-aqua underline hover:no-underline"
            onClick={() => setState("idle")}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
