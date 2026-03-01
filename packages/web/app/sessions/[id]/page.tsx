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
        const [s, evs] = await Promise.all([
          getSession(sessionId),
          getSessionEvents(sessionId),
        ]);
        setSession(s ?? null);
        setEvents(Array.isArray(evs) ? evs : []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm bg-gray-950">
        Loading session…
      </div>
    );
  }

  if (!session) {
    return <div className="p-8 text-gray-400 bg-gray-950 min-h-screen">Session not found.</div>;
  }

  const summary = session.summary as Record<string, number> | null;
  const nudgeCount = events.filter((e) => e.event_type === "nudge").length;
  const qaCount = events.filter((e) => e.event_type === "qa_event").length;
  const qaWhispered = events.filter(
    (e) => e.event_type === "qa_event" && e.payload.whispered
  ).length;

  const paceSeries = buildMetricSeries(events, "audio_signal", "words_per_minute");
  const pitchSeries = buildMetricSeries(events, "audio_signal", "pitch_variance");
  const volumeSeries = buildMetricSeries(events, "audio_signal", "volume_rms");
  const attentionSeries = buildMetricSeries(events, "audience_signal", "attention_score");

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 bg-gray-950 text-gray-100 min-h-screen">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/app" className="hover:text-aqua transition-colors">Sessions</Link>
        <span>/</span>
        <span className="text-gray-400">
          {format(new Date(session.started_at), "MMM d, yyyy")}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-gray-700">
            {(["transcript", "nudges", "charts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-aqua text-aqua"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab}
              </button>
            ))}
            <Link
              href={`/sessions/${sessionId}/report`}
              className="ml-auto px-4 py-2 text-sm font-medium text-aqua hover:underline"
            >
              Full Report →
            </Link>
          </div>

          {activeTab === "transcript" && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5 max-h-[60vh] overflow-y-auto">
              <TranscriptPlayer
                events={events}
                sessionStartedAt={session.started_at}
                currentTime={currentTime}
              />
            </div>
          )}

          {activeTab === "nudges" && (
            <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
              <NudgeTimeline
                events={events}
                sessionStartedAt={session.started_at}
                onSeek={(ts) => {
                  const sec =
                    (new Date(ts).getTime() - new Date(session.started_at).getTime()) / 1000;
                  setCurrentTime(Math.max(0, sec));
                  setActiveTab("transcript");
                }}
              />
            </div>
          )}

          {activeTab === "charts" && (
            <div className="space-y-6 rounded-xl border border-gray-700 bg-gray-900/50 p-5">
              <MetricsChart data={paceSeries} label="Speaking Pace (WPM)" color="#00d4aa" unit=" wpm" yMin={0} />
              <MetricsChart data={pitchSeries} label="Pitch Variance" color="#00d4aa" unit="" yMin={0} />
              <MetricsChart data={volumeSeries} label="Volume (RMS)" color="#00d4aa" unit="" yMin={0} />
              <AttentionHeatmap data={attentionSeries} />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="w-full lg:w-64 shrink-0">
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Score</p>
              <p className={`text-4xl font-bold mt-1 ${
                (session.overall_score ?? 0) >= 80
                  ? "text-aqua"
                  : (session.overall_score ?? 0) >= 60
                  ? "text-gray-300"
                  : "text-gray-400"
              }`}>
                {session.overall_score != null ? Math.round(session.overall_score) : "—"}
              </p>
            </div>

            <hr className="border-gray-700" />

            <Stat label="Duration" value={formatDur(session.duration_seconds)} />
            <Stat label="Nudges" value={String(nudgeCount)} />
            <Stat label="Q&A events" value={String(qaCount)} />
            <Stat label="Whispers delivered" value={String(qaWhispered)} />

            {summary && (
              <>
                <hr className="border-gray-700" />
                {summary.avg_wpm != null && (
                  <Stat label="Avg WPM" value={String(Math.round(summary.avg_wpm))} />
                )}
                {summary.total_fillers != null && (
                  <Stat label="Filler words" value={String(summary.total_fillers)} />
                )}
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
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-200">{value}</span>
    </div>
  );
}
