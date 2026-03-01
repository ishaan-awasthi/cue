import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_KEY must be set");
  _client = createClient(url, key);
  return _client;
}

export const supabase = {
  from: (table: string) => getClient().from(table),
} as SupabaseClient;

/** Same user ID as API (X-User-Id). Use for all Supabase queries. */
export function getCurrentUserId(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_USER_ID) {
    return process.env.NEXT_PUBLIC_USER_ID;
  }
  return "00000000-0000-0000-0000-000000000001";
}

// ---------------------------------------------------------------------------
// Types (mirror backend db/models.py)
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
  summary: Record<string, unknown> | null;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  timestamp: string;
  event_type: "audio_signal" | "audience_signal" | "nudge" | "qa_event";
  payload: Record<string, unknown>;
}

export interface MetricRow {
  id: string;
  user_id: string;
  session_id: string;
  metric_name: string;
  value: number;
  recorded_at: string;
}

export interface UploadedFile {
  id: string;
  user_id: string;
  filename: string;
  file_type: string;
  uploaded_at: string;
  chunk_count: number;
}

// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Session;
}

export async function listSessions(userId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Session[];
}

export async function getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const { data, error } = await supabase
    .from("session_events")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SessionEvent[];
}

export async function getMetrics(userId: string): Promise<MetricRow[]> {
  const { data, error } = await supabase
    .from("metrics")
    .select("*")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MetricRow[];
}

export async function listFiles(userId: string): Promise<UploadedFile[]> {
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UploadedFile[];
}
