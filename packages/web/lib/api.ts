/**
 * Typed fetch wrapper for FastAPI backend calls.
 * Base URL from NEXT_PUBLIC_API_URL env var.
 * All session, events, files, and report data is fetched from the backend for insights.
 */

import type { Session, SessionEvent, UploadedFile } from "./supabase";

export type { Session, SessionEvent, UploadedFile };

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

// ---------------------------------------------------------------------------
// Transcript analysis
// ---------------------------------------------------------------------------

export interface TranscriptIndicator {
  label: string;
  score: number;        // 0–100
  value: string;        // e.g. "3.2/min (12 total)"
  blurb: string;
}

export interface TranscriptAnalysisResult {
  session_id: string;
  transcript_found: boolean;
  transcript_length: number;
  word_count: number;
  duration_estimate_seconds: number;
  indicators: TranscriptIndicator[];
  overall_score: number;
  filler_words_detail: Record<string, number>;
  transcript_excerpt: string;
}

export async function getTranscriptAnalysis(sessionId: string): Promise<TranscriptAnalysisResult> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/transcript-analysis`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`transcript-analysis failed: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Practice drill analysis
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
  if (!res.ok) throw new Error(`Practice analyze failed: ${res.statusText}`);
  return res.json();
}
