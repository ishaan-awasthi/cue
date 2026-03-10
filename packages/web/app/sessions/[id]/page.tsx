"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { getSession, getSessionEvents, type Session, type SessionEvent } from "../../../lib/api";
import TranscriptPlayer from "../../../components/TranscriptPlayer";
import NudgeTimeline from "../../../components/NudgeTimeline";
import MetricsChart, { type MetricDataPoint } from "../../../components/MetricsChart";
import AttentionHeatmap from "../../../components/AttentionHeatmap";

function formatDur(seconds: number | null): string {
  if (!seconds) return "—";
  const dur = intervalToDuration({ start: 0, end: seconds * 1000 });
  return formatDuration(dur, { format: ["minutes", "seconds"] });
}

function buildMetricSeries(events: SessionEvent[], eventType: string, payloadKey: string): MetricDataPoint[] {
  return events
    .filter((e) => e.event_type === eventType)
    .map((e) => ({
      timestamp: e.timestamp,
      value: Number(e.payload[payloadKey] ?? 0),
    }));
}

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"transcript" | "nudges" | "charts">("transcript");

  useEffect(() => {
    async function load() {
      try {
        const [s, evs] = await Promise.all([getSession(sessionId), getSessionEvents(sessionId)]);
        setSession(s ?? null);
        setEvents(Array.isArray(evs) ? evs : []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  if (loading) {
    return <div className="flex items-center justify-center h-64" style={{ background: "var(--bg)", color: "rgba(240,245,243,0.4)", fontSize: "0.875rem" }}>Loading session…</div>;
  }

  if (!session) {
    return <div style={{ padding: "32px", color: "rgba(240,245,243,0.5)", background: "var(--bg)", minHeight: "100vh" }}>Session not found.</div>;
  }

  const summary = session.summary as Record<string, number> | null;
  const nudgeCount = events.filter((e) => e.event_type === "nudge").length;
  const qaCount = events.filter((e) => e.event_type === "qa_event").length;
  const qaWhispered = events.filter((e) => e.event_type === "qa_event" && e.payload.whispered).length;

  const paceSeries = buildMetricSeries(events, "audio_signal", "words_per_minute");
  const pitchSeries = buildMetricSeries(events, "audio_signal", "pitch_variance");
  const volumeSeries = buildMetricSeries(events, "audio_signal", "volume_rms");
  const attentionSeries = buildMetricSeries(events, "audience_signal", "attention_score");

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 16px", background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", marginBottom: "32px" }}>
        <Link href="/app" style={{ color: "rgba(240,245,243,0.4)" }}>Sessions</Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <span style={{ color: "rgba(240,245,243,0.6)" }}>{format(new Date(session.started_at), "MMM d, yyyy")}</span>
      </div>

      <div className="flex flex-col lg:flex-row" style={{ gap: "32px" }}>
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex" style={{ gap: 0, marginBottom: "24px", borderBottom: "1px solid rgba(45,255,192,0.1)" }}>
            {(["transcript", "nudges", "charts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 16px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  transition: "color 0.15s",
                  color: activeTab === tab ? "var(--aqua)" : "rgba(240,245,243,0.4)",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === tab ? "2px solid var(--aqua)" : "2px solid transparent",
                  cursor: "pointer",
                  marginBottom: "-1px",
                }}
              >
                {tab}
              </button>
            ))}
            <Link
              href={`/sessions/${sessionId}/report`}
              style={{ marginLeft: "auto", padding: "10px 16px", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--aqua)" }}
            >
              Full Report →
            </Link>
          </div>

          {activeTab === "transcript" && (
            <div className="feature-card" style={{ maxHeight: "60vh", overflowY: "auto", padding: "20px" }}>
              <TranscriptPlayer events={events} sessionStartedAt={session.started_at} currentTime={currentTime} />
            </div>
          )}

          {activeTab === "nudges" && (
            <div className="feature-card" style={{ padding: "20px" }}>
              <NudgeTimeline
                events={events}
                sessionStartedAt={session.started_at}
                onSeek={(ts) => {
                  const sec = (new Date(ts).getTime() - new Date(session.started_at).getTime()) / 1000;
                  setCurrentTime(Math.max(0, sec));
                  setActiveTab("transcript");
                }}
              />
            </div>
          )}

          {activeTab === "charts" && (
            <div className="feature-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "32px" }}>
              <MetricsChart data={paceSeries} label="Speaking pace" unit=" wpm" yMin={0} />
              <MetricsChart data={pitchSeries} label="Pitch variance" unit="" yMin={0} />
              <MetricsChart data={volumeSeries} label="Volume (RMS)" unit="" yMin={0} />
              <AttentionHeatmap data={attentionSeries} />
            </div>
          )}
        </div>

        {/* Sidebar stats */}
        <aside style={{ width: "100%", maxWidth: "224px", flexShrink: 0 }}>
          <div className="feature-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "4px" }}>Score</p>
              <p
                style={{
                  fontSize: "3rem",
                  fontWeight: 900,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.95,
                  color: (session.overall_score ?? 0) >= 80 ? "var(--aqua)" : "var(--fg)",
                }}
              >
                {session.overall_score != null ? Math.round(session.overall_score) : "—"}
              </p>
            </div>

            <div style={{ height: "1px", background: "rgba(45,255,192,0.1)" }} />

            {[
              { label: "Duration", value: formatDur(session.duration_seconds) },
              { label: "Nudges", value: String(nudgeCount) },
              { label: "Q&A events", value: String(qaCount) },
              { label: "Whispers", value: String(qaWhispered) },
            ].map(({ label, value }) => (
              <Stat key={label} label={label} value={value} />
            ))}

            {summary && (
              <>
                <div style={{ height: "1px", background: "rgba(45,255,192,0.1)" }} />
                {summary.avg_wpm != null && <Stat label="Avg WPM" value={String(Math.round(summary.avg_wpm))} />}
                {summary.total_fillers != null && <Stat label="Filler words" value={String(summary.total_fillers)} />}
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: "8px" }}>
      <span style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--fg)" }}>{value}</span>
    </div>
  );
}
