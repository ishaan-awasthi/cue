/**
 * Typed fetch wrapper for FastAPI backend calls.
 * Base URL from NEXT_PUBLIC_API_URL env var.
 *
 * Most reads go through Supabase directly (lib/supabase.ts).
 * This file handles writes and operations requiring backend logic.
 */

import type { Session, UploadedFile } from "./supabase";

export type { Session };

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Default user ID used in dev.  In production replace with real auth.
const DEFAULT_USER_ID =
  process.env.NEXT_PUBLIC_USER_ID ?? "00000000-0000-0000-0000-000000000001";

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    "X-User-Id": DEFAULT_USER_ID,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`getSessions failed: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createSession(): Promise<Session> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`createSession failed: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Prep chat (GPT)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function sendChatMessage(
  _sessionId: string,
  message: string,
  history: ChatMessage[]
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Chat failed: ${res.statusText}`);
  }
  const data = await res.json();
  return data.reply ?? "";
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface CoachingReport {
  session_id: string;
  report: {
    what_went_well: string[];
    areas_to_improve: string[];
    fluency_summary: string;
    key_moments: Array<{ timestamp: string; observation: string }>;
    suggested_drills: string[];
  };
}

export async function getSessionReport(sessionId: string): Promise<CoachingReport> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/report`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`getSessionReport failed: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface UploadResult {
  file: UploadedFile;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/files/upload`, {
    method: "POST",
    headers: headers(),   // no Content-Type — browser sets it for FormData
    body: form,
  });
  if (!res.ok) throw new Error(`uploadFile failed: ${res.statusText}`);
  return res.json();
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/files/${fileId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`deleteFile failed: ${res.statusText}`);
}
