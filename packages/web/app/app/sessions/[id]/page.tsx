"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  getSession,
  getSessionEvents,
  getSessionReport,
  sendChatMessage,
  createSession,
  endSession,
  sessionWebSocketUrl,
  type Session,
  type CoachingReport,
  type ChatMessage,
  type SessionEvent,
} from "../../../../lib/api";
import FileUploader from "../../../../components/FileUploader";
import MetricsChart from "../../../../components/MetricsChart";
import type { UploadedFile } from "../../../../lib/supabase";

function mockSession(id: string): Session {
  return {
    id,
    user_id: "",
    started_at: new Date().toISOString(),
    ended_at: null,
    duration_seconds: null,
    overall_score: null,
    summary: null,
  };
}

type Phase = "prep" | "in_progress" | "ratings";
type InProgressTab = "chat" | "metrics";

const DEMO_OVERALL_SCORE = 78;
const DEMO_FLAGS = [
  "Reduce filler words in the first 2 minutes",
  "Pace increased in the middle section — consider pausing more",
  "Audience attention dipped around the 4-min mark",
];

function demoTimeSeries(
  baseTs: number,
  count: number,
  intervalSec: number,
  values: number[]
): { timestamp: string; value: number }[] {
  return values.map((value, i) => ({
    timestamp: new Date(baseTs + i * intervalSec * 1000).toISOString(),
    value,
  }));
}

function getDemoMetrics(sessionStartedAt: string) {
  const base = new Date(sessionStartedAt).getTime();
  return {
    retention: demoTimeSeries(base, 12, 30, [82, 85, 78, 88, 90, 72, 75, 80, 85, 88, 82, 86]),
    wpm: demoTimeSeries(base, 10, 36, [118, 128, 122, 135, 142, 138, 125, 132, 128, 130]),
    fillerRate: demoTimeSeries(base, 8, 45, [2.2, 3.1, 2.8, 2.0, 1.8, 2.5, 2.1, 1.9]),
  };
}

function deriveMetricsFromEvents(events: SessionEvent[]): {
  retention: { timestamp: string; value: number }[];
  wpm: { timestamp: string; value: number }[];
  fillerRate: { timestamp: string; value: number }[];
  flags: string[];
} {
  const audio = events.filter((e) => e.event_type === "audio_signal");
  const audience = events.filter((e) => e.event_type === "audience_signal");
  const nudges = events.filter((e) => e.event_type === "nudge");

  const retention = audience.map((e) => ({
    timestamp: typeof e.timestamp === "string" ? e.timestamp : new Date(e.timestamp).toISOString(),
    value: Math.round((Number((e.payload as Record<string, unknown>)?.attention_score ?? 0)) * 100),
  }));

  const wpm = audio.map((e) => ({
    timestamp: typeof e.timestamp === "string" ? e.timestamp : new Date(e.timestamp).toISOString(),
    value: Number((e.payload as Record<string, unknown>)?.words_per_minute ?? 0),
  }));

  const fillerRate = audio.map((e) => ({
    timestamp: typeof e.timestamp === "string" ? e.timestamp : new Date(e.timestamp).toISOString(),
    value: Number((e.payload as Record<string, unknown>)?.filler_word_count ?? 0) * 12,
  }));

  const flags = nudges
    .map((e) => (e.payload as Record<string, unknown>)?.text as string)
    .filter(Boolean);

  return { retention, wpm, fillerRate, flags };
}

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("prep");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "I'll use the context you uploaded to help during your session. Ask me any clarifying questions about your topic or audience before you start.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [report, setReport] = useState<CoachingReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [inProgressTab, setInProgressTab] = useState<InProgressTab>("chat");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const startLiveSession = useCallback(async (sid: string) => {
    setLiveError(null);
    const wsUrl = sessionWebSocketUrl(sid);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const onOpen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const sampleRate = 48000;
        const ctx = new AudioContext({ sampleRate });
        audioContextRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const outLength = Math.floor(input.length / 3);
          const pcm = new Int16Array(outLength);
          for (let i = 0; i < outLength; i++) {
            const s = input[i * 3];
            const v = Math.max(-1, Math.min(1, s));
            pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        src.connect(processor);
        processor.connect(ctx.destination);
        setIsLive(true);
      } catch (err) {
        setLiveError(err instanceof Error ? err.message : "Could not access microphone");
        ws.close();
      }
    };
    ws.onopen = onOpen;
    ws.onerror = () => setLiveError("WebSocket error");
    ws.onclose = () => {
      wsRef.current = null;
      setIsLive(false);
    };
  }, []);

  const endLiveSession = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx) {
      ctx.close().catch(() => {});
      audioContextRef.current = null;
    }
    processorRef.current = null;
    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }
    setIsLive(false);
    setLiveError(null);
  }, []);

  useEffect(() => {
    getSession(sessionId)
      .then((s) => {
        setSession(s ?? mockSession(sessionId));
        if (s?.ended_at) setPhase("ratings");
        return s?.id ? getSessionEvents(sessionId) : [];
      })
      .then((evts) => setEvents(evts))
      .catch(() => {
        setSession(mockSession(sessionId));
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (phase === "ratings" && session?.ended_at && !report) {
      setReportLoading(true);
      getSessionReport(sessionId)
        .then(setReport)
        .catch(() => setReport(null))
        .finally(() => setReportLoading(false));
    }
  }, [phase, session?.ended_at, sessionId, report]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      if (isLive) endLiveSession();
    };
  }, [isLive, endLiveSession]);

  const derivedMetrics = useMemo(
    () => (events.length > 0 ? deriveMetricsFromEvents(events) : null),
    [events]
  );

  const handleUploaded = (_file: UploadedFile) => {};

  const handleSendMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatSending) return;
    setChatInput("");
    setChatError(null);
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatSending(true);
    try {
      const reply = await sendChatMessage(sessionId, trimmed, chatMessages);
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Chat failed");
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't reach the coach right now. Please try again." },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1" style={{ color: "rgba(240,245,243,0.4)", fontSize: "0.875rem" }}>
        Loading session…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center flex-1" style={{ gap: "16px" }}>
        <p style={{ color: "rgba(240,245,243,0.5)" }}>Session not found.</p>
        <Link href="/app" style={{ color: "var(--aqua)", fontSize: "0.875rem" }}>Back to app</Link>
      </div>
    );
  }

  const hasRatingsData = Boolean(session.ended_at && session.summary);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div
        className="shrink-0 flex items-center gap-2"
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid rgba(45,255,192,0.1)",
          fontSize: "0.875rem",
          color: "rgba(240,245,243,0.4)",
        }}
      >
        <Link href="/app" style={{ color: "rgba(240,245,243,0.4)", transition: "color 0.15s" }} onMouseEnter={e => (e.currentTarget.style.color = "var(--aqua)")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(240,245,243,0.4)")}>
          Sessions
        </Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <span style={{ color: "rgba(240,245,243,0.7)" }}>
          {format(new Date(session.started_at), "MMM d, yyyy")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: "24px" }}>

        {/* ── Prep ── */}
        {phase === "prep" && (
          <div className="fade-in-up" style={{ maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
            <section>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>
                Context for your session
              </p>
              <div className="feature-card" style={{ padding: "16px" }}>
                <FileUploader onUploaded={handleUploaded} />
              </div>
            </section>

            <section>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>
                Clarifying questions
              </p>
              <div className="feature-card" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", minHeight: "200px", maxHeight: "320px" }}>
                  {chatMessages.map((m, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "85%",
                        borderRadius: "12px",
                        padding: "8px 14px",
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                        background: m.role === "user" ? "rgba(45,255,192,0.15)" : "rgba(240,245,243,0.06)",
                        color: "var(--fg)",
                      }}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{ padding: "12px", borderTop: "1px solid rgba(45,255,192,0.1)", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {chatError && <p style={{ fontSize: "0.75rem", color: "#f87171" }}>{chatError}</p>}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !chatSending && handleSendMessage()}
                      placeholder="Type a message…"
                      disabled={chatSending}
                      style={{
                        flex: 1,
                        borderRadius: "12px",
                        border: "1px solid rgba(45,255,192,0.12)",
                        background: "rgba(240,245,243,0.04)",
                        padding: "8px 12px",
                        fontSize: "0.875rem",
                        color: "var(--fg)",
                        outline: "none",
                        opacity: chatSending ? 0.5 : 1,
                      }}
                    />
                    <button onClick={handleSendMessage} disabled={chatSending} className="btn-pill btn-primary" style={{ padding: "8px 20px" }}>
                      {chatSending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <div style={{ paddingTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {liveError && <p style={{ fontSize: "0.875rem", color: "#f87171" }} role="alert">{liveError}</p>}
              <button
                onClick={async () => {
                  let sid = sessionId;
                  let currentSession = session;
                  if (!currentSession?.user_id) {
                    try {
                      const newSession = await createSession();
                      currentSession = newSession;
                      sid = newSession.id;
                      setSession(newSession);
                      window.history.replaceState(null, "", `/app/sessions/${newSession.id}`);
                    } catch (e) {
                      setLiveError(e instanceof Error ? e.message : "Could not create session");
                      return;
                    }
                  }
                  await startLiveSession(sid);
                  setPhase("in_progress");
                }}
                disabled={isLive}
                className="btn-pill btn-primary"
                style={{ alignSelf: "flex-start" }}
              >
                {isLive ? "Live…" : "Start session"}
              </button>
            </div>
          </div>
        )}

        {/* ── In progress ── */}
        {phase === "in_progress" && session && (
          <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
            {liveError && <p style={{ fontSize: "0.875rem", color: "#f87171" }} role="alert">{liveError}</p>}

            {/* Toolbar */}
            <div className="flex items-center flex-wrap" style={{ justifyContent: "space-between", gap: "12px" }}>
              <div className="flex items-center" style={{ gap: "12px" }}>
                {isLive && (
                  <span className="flex items-center" style={{ gap: "6px", fontSize: "0.75rem", color: "var(--aqua)" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--aqua)", display: "inline-block", animation: "pulse 2s infinite" }} aria-hidden />
                    Live
                  </span>
                )}
                {/* Tab switcher */}
                <div style={{ display: "flex", borderRadius: "999px", border: "1px solid rgba(45,255,192,0.12)", background: "rgba(240,245,243,0.03)", padding: "4px", gap: "4px" }}>
                  {(["chat", "metrics"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setInProgressTab(tab)}
                      style={{
                        borderRadius: "999px",
                        padding: "6px 16px",
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        transition: "background 0.15s, color 0.15s",
                        background: inProgressTab === tab ? "var(--aqua)" : "transparent",
                        color: inProgressTab === tab ? "var(--bg)" : "rgba(240,245,243,0.5)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => {
                  endSession(sessionId).catch(() => {});
                  endLiveSession();
                  setPhase("ratings");
                  getSession(sessionId).then((s) => s && setSession(s)).catch(() => {});
                  getSessionEvents(sessionId).then(setEvents).catch(() => {});
                }}
                className="btn-pill btn-ghost"
                style={{ padding: "8px 20px" }}
              >
                End session
              </button>
            </div>

            {/* Chat tab */}
            {inProgressTab === "chat" && (
              <div className="feature-card flex flex-col sm:flex-row" style={{ gap: "32px", alignItems: "flex-start", padding: "24px" }}>
                {/* Score ring */}
                <div className="shrink-0 flex flex-col items-center" style={{ gap: "8px" }}>
                  <div className="relative glow-pulse" style={{ width: "112px", height: "112px", borderRadius: "50%" }}>
                    <svg className="w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="rgba(45,255,192,0.12)"
                        strokeWidth="2.5"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#2DFFC0"
                        strokeWidth="2.5"
                        strokeDasharray={`${session?.overall_score ?? DEMO_OVERALL_SCORE} ${100 - (session?.overall_score ?? DEMO_OVERALL_SCORE)}`}
                        strokeLinecap="round"
                        style={{ transition: "all 0.7s" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--fg)" }}>
                        {session?.overall_score != null ? Math.round(session.overall_score) : DEMO_OVERALL_SCORE}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600 }}>Overall</p>
                </div>

                {/* Chat */}
                <div className="flex-1 min-w-0 w-full" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600 }}>Coach chat</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "280px", overflowY: "auto", paddingRight: "4px" }}>
                    {chatMessages.map((m, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth: "85%",
                          borderRadius: "12px",
                          padding: "8px 14px",
                          fontSize: "0.875rem",
                          lineHeight: 1.6,
                          background: m.role === "user" ? "rgba(45,255,192,0.15)" : "rgba(240,245,243,0.06)",
                          color: "var(--fg)",
                        }}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {chatError && <p style={{ fontSize: "0.75rem", color: "#f87171" }}>{chatError}</p>}
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !chatSending && handleSendMessage()}
                      placeholder="Ask anything…"
                      disabled={chatSending}
                      style={{
                        flex: 1,
                        borderRadius: "12px",
                        border: "1px solid rgba(45,255,192,0.12)",
                        background: "rgba(240,245,243,0.04)",
                        padding: "8px 12px",
                        fontSize: "0.875rem",
                        color: "var(--fg)",
                        outline: "none",
                        opacity: chatSending ? 0.5 : 1,
                      }}
                    />
                    <button onClick={handleSendMessage} disabled={chatSending} className="btn-pill btn-primary" style={{ padding: "8px 20px" }}>
                      {chatSending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Metrics tab */}
            {inProgressTab === "metrics" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {(derivedMetrics?.flags.length ?? DEMO_FLAGS.length) > 0 && (
                  <section className="feature-card">
                    <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>Flags</p>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {(derivedMetrics?.flags ?? DEMO_FLAGS).map((item, i) => (
                        <li key={i} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", display: "flex", gap: "8px" }}>
                          <span style={{ color: "var(--aqua)", flexShrink: 0 }}>—</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className="feature-card">
                  <MetricsChart data={derivedMetrics?.retention ?? getDemoMetrics(session.started_at).retention} label="Audience attention" yMin={0} yMax={100} unit="%" />
                </section>
                <section className="feature-card">
                  <MetricsChart data={derivedMetrics?.wpm ?? getDemoMetrics(session.started_at).wpm} label="Speaking pace" yMin={80} yMax={180} unit=" wpm" />
                </section>
                <section className="feature-card">
                  <MetricsChart data={derivedMetrics?.fillerRate ?? getDemoMetrics(session.started_at).fillerRate} label="Filler words" yMin={0} yMax={8} unit="/min" />
                </section>
              </div>
            )}
          </div>
        )}

        {/* ── Ratings ── */}
        {phase === "ratings" && (
          <div className="fade-in-up" style={{ maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
            {!hasRatingsData ? (
              <div className="feature-card" style={{ padding: "40px", textAlign: "center", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
                <p style={{ fontWeight: 700, letterSpacing: "-0.02em", color: "rgba(240,245,243,0.7)" }}>No ratings data yet</p>
                <p style={{ fontSize: "0.875rem", lineHeight: 1.7, color: "rgba(240,245,243,0.4)" }}>
                  Complete a session with your Cue glasses to see filler words, speaking speed, audience retention, and overall rating here.
                </p>
                <Link href={`/sessions/${sessionId}`} style={{ fontSize: "0.875rem", color: "var(--aqua)", marginTop: "8px" }}>
                  View session details →
                </Link>
              </div>
            ) : (
              <>
                <section className="feature-card">
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>Overall score</p>
                  <p style={{ fontSize: "clamp(3rem, 8vw, 5rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, color: "var(--aqua)" }}>
                    {session.overall_score != null ? Math.round(session.overall_score) : "—"}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.3)", marginTop: "8px" }}>out of 100</p>
                </section>

                <section className="feature-card">
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "20px" }}>Breakdown</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
                    {[
                      { label: "Filler words", value: (session.summary as Record<string, unknown>)?.total_fillers != null ? String((session.summary as Record<string, unknown>).total_fillers) : "—" },
                      { label: "Avg. speed", value: (session.summary as Record<string, unknown>)?.avg_wpm != null ? `${Math.round((session.summary as Record<string, unknown>).avg_wpm as number)} wpm` : "—" },
                      { label: "Attention", value: (session.summary as Record<string, unknown>)?.avg_attention != null ? `${Math.round((session.summary as Record<string, unknown>).avg_attention as number * 100)}%` : "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "4px" }}>{label}</p>
                        <p style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--fg)" }}>{value}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {reportLoading && <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>Loading report…</p>}

                {report && report.report.areas_to_improve?.length > 0 && (
                  <section className="feature-card">
                    <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>Areas to improve</p>
                    <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {report.report.areas_to_improve.map((item, i) => (
                        <li key={i} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", display: "flex", gap: "8px" }}>
                          <span style={{ color: "var(--aqua)", flexShrink: 0 }}>—</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report && (
                  <div style={{ display: "flex", gap: "16px", paddingTop: "4px" }}>
                    <Link href={`/sessions/${sessionId}/report`} style={{ fontSize: "0.875rem", color: "var(--aqua)", fontWeight: 600 }}>Full report →</Link>
                    <Link href={`/sessions/${sessionId}`} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", transition: "color 0.15s" }}>Transcript & charts</Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
