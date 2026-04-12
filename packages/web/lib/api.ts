/**
 * Typed fetch wrapper for FastAPI backend calls.
 * Base URL from NEXT_PUBLIC_API_URL env var.
 * All session, events, files, and report data is fetched from the backend for insights.
 */

import type { Session, SessionEvent, UploadedFile } from "./supabase";

export type { Session, SessionEvent, UploadedFile };

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Default user ID used in dev.  In production replace with real auth.
export const DEFAULT_USER_ID =
  process.env.NEXT_PUBLIC_USER_ID ?? "00000000-0000-0000-0000-000000000001";

/** WebSocket URL for live session audio streaming (ws scheme, same host/port as API). */
export function sessionWebSocketUrl(sessionId: string): string {
  const base = BASE_URL.replace(/^http/, "ws");
  return `${base}/ws/${sessionId}?user_id=${encodeURIComponent(DEFAULT_USER_ID)}`;
}

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

export async function getSession(sessionId: string): Promise<Session | null> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}`, {
    method: "GET",
    headers: headers(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getSession failed: ${res.statusText}`);
  return res.json();
}

export async function getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/events`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`getSessionEvents failed: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function createSession(): Promise<Session> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { detail?: string }).detail ?? res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const data = await res.json();
  if (!data?.id) throw new Error("Invalid session response");
  return data as Session;
}

/** Tell the backend to end the live session: close the WebSocket so audio/vision processing stops. */
export async function endSession(sessionId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/end`, {
    method: "POST",
    headers: headers(),
  });
  if (res.status === 204) return;
  if (!res.ok) throw new Error(`endSession failed: ${res.statusText}`);
}

// ---------------------------------------------------------------------------
// Prep chat (GPT)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
  history: ChatMessage[]
): Promise<string> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `Chat failed: ${res.statusText}`);
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

export async function listFiles(): Promise<UploadedFile[]> {
  const res = await fetch(`${BASE_URL}/files`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`listFiles failed: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function listSessionFiles(sessionId: string): Promise<UploadedFile[]> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/files`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`listSessionFiles failed: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function uploadFile(file: File, sessionId?: string): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const url = sessionId ? `${BASE_URL}/sessions/${sessionId}/files` : `${BASE_URL}/files/upload`;
  const res = await fetch(url, {
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

export interface SessionQAResponse {
  answer: string;
  source: "session_docs" | "llm_fallback";
  confidence: number;
  supporting_context: Array<{ fileName: string; location: string }>;
  status?: "ready" | "processing";
}

export async function askSessionQuestion(
  sessionId: string,
  question: string
): Promise<SessionQAResponse> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/qa`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `session QA failed: ${res.statusText}`);
  }
// ---------------------------------------------------------------------------
// Practice Mode
// ---------------------------------------------------------------------------

export interface PracticeNudge {
  trigger: string;
  text: string;
  value: number;
}

export interface PracticeAnalyzeResult {
  score: number;
  nudges: PracticeNudge[];
  filler_words_found: string[];
  wpm: number;
}

export async function analyzePracticeDrill(opts: {
  transcript: string;
  words_per_minute: number;
  filler_word_count: number;
  duration_seconds: number;
}): Promise<PracticeAnalyzeResult> {
  const res = await fetch(`${BASE_URL}/practice/analyze`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`analyzePracticeDrill failed: ${res.statusText}`);
  return res.json();
}
