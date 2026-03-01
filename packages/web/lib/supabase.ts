import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

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
