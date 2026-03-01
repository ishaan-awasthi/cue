"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getSession, type Session } from "../../../../lib/supabase";

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
import {
  getSessionReport,
  sendChatMessage,
  type CoachingReport,
  type ChatMessage,
} from "../../../../lib/api";
import FileUploader from "../../../../components/FileUploader";
import MetricsChart from "../../../../components/MetricsChart";
import type { UploadedFile } from "../../../../lib/supabase";

type Phase = "prep" | "in_progress" | "ratings";
type InProgressTab = "chat" | "metrics";

// Artificial data for "what it would look like after" (demo when in_progress)
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
        "I’ll use the context you uploaded to help during your session. Ask me any clarifying questions about your topic or audience before you start.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [report, setReport] = useState<CoachingReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [inProgressTab, setInProgressTab] = useState<InProgressTab>("chat");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSession(sessionId)
      .then((s) => {
        setSession(s ?? mockSession(sessionId));
        if (s?.ended_at) setPhase("ratings");
      })
      .catch(() => {
        setSession(mockSession(sessionId));
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

  const handleUploaded = (_file: UploadedFile) => {
    // Optional: keep context file IDs in state for display
  };

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
        {
          role: "assistant",
          content: "Sorry, I couldn’t reach the coach right now. Please try again.",
        },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-gray-500 text-sm">
        Loading session…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <p className="text-gray-400">Session not found.</p>
        <Link href="/app" className="text-aqua hover:underline text-sm">
          Back to app
        </Link>
      </div>
    );
  }

  const hasRatingsData = Boolean(session.ended_at && session.summary);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div className="shrink-0 flex items-center gap-2 text-sm text-gray-500 px-6 py-3 border-b border-gray-800">
        <Link href="/app" className="hover:text-aqua transition-colors">
          Sessions
        </Link>
        <span>/</span>
        <span className="text-gray-300">
          {format(new Date(session.started_at), "MMM d, yyyy")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Prep */}
        {phase === "prep" && (
          <div className="max-w-2xl mx-auto space-y-8">
            <section>
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Context for your conversation
              </h2>
              <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
                <FileUploader onUploaded={handleUploaded} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Clarifying questions
              </h2>
              <div className="rounded-xl border border-gray-700 bg-gray-900/50 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[320px]">
                  {chatMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          m.role === "user"
                            ? "bg-aqua/20 text-gray-100"
                            : "bg-gray-700 text-gray-200"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="flex flex-col gap-2 p-3 border-t border-gray-700">
                  {chatError && (
                    <p className="text-xs text-gray-400">{chatError}</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !chatSending && handleSendMessage()}
                      placeholder="Type a message…"
                      disabled={chatSending}
                      className="flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-aqua disabled:opacity-50"
                    />
                    <button
                      onClick={() => handleSendMessage()}
                      disabled={chatSending}
                      className="rounded-lg bg-aqua px-4 py-2 text-sm font-medium text-gray-950 hover:bg-aqua-300 transition-colors disabled:opacity-50"
                    >
                      {chatSending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <div className="pt-4">
              <button
                onClick={() => setPhase("in_progress")}
                className="rounded-lg bg-aqua px-6 py-3 text-sm font-medium text-gray-950 hover:bg-aqua-300 transition-colors"
              >
                Start conversation
              </button>
            </div>
          </div>
        )}

        {/* In progress: tabbed view with Chat (score ring) + Metrics (graphs, artificial data) */}
        {phase === "in_progress" && session && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex rounded-lg border border-gray-700 bg-gray-900/50 p-1">
                <button
                  onClick={() => setInProgressTab("chat")}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    inProgressTab === "chat"
                      ? "bg-aqua text-gray-950"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setInProgressTab("metrics")}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    inProgressTab === "metrics"
                      ? "bg-aqua text-gray-950"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Metrics
                </button>
              </div>
              <button
                onClick={() => setPhase("ratings")}
                className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 hover:border-aqua hover:text-aqua transition-colors"
              >
                End conversation
              </button>
            </div>

            {inProgressTab === "chat" && (
              <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6 flex flex-col sm:flex-row gap-8 items-start">
                {/* Overall score ring */}
                <div className="shrink-0 flex flex-col items-center">
                  <div className="relative w-32 h-32">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        className="text-gray-700"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeDasharray={`${DEMO_OVERALL_SCORE} ${100 - DEMO_OVERALL_SCORE}`}
                        strokeLinecap="round"
                        className="text-aqua transition-all duration-700"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">
                        {DEMO_OVERALL_SCORE}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Overall score</p>
                </div>
                {/* Chat thread */}
                <div className="flex-1 min-w-0 w-full space-y-4">
                  <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
                    Clarifying questions
                  </h3>
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2">
                    {chatMessages.map((m, i) => (
                      <div
                        key={i}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            m.role === "user"
                              ? "bg-aqua/20 text-gray-100"
                              : "bg-gray-700 text-gray-200"
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex flex-col gap-2">
                    {chatError && (
                      <p className="text-xs text-gray-400">{chatError}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && !chatSending && handleSendMessage()
                        }
                        placeholder="Type a message…"
                        disabled={chatSending}
                        className="flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-aqua disabled:opacity-50"
                      />
                      <button
                        onClick={() => handleSendMessage()}
                        disabled={chatSending}
                        className="rounded-lg bg-aqua px-4 py-2 text-sm font-medium text-gray-950 hover:bg-aqua-300 transition-colors disabled:opacity-50"
                      >
                        {chatSending ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {inProgressTab === "metrics" && (
              <div className="space-y-6">
                {/* Flags */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">
                    Flags
                  </h2>
                  <ul className="space-y-2">
                    {DEMO_FLAGS.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-gray-300 flex gap-2"
                      >
                        <span className="text-aqua shrink-0">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Speech retention */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <MetricsChart
                    data={getDemoMetrics(session.started_at).retention}
                    label="Speech retention (audience attention %)"
                    yMin={0}
                    yMax={100}
                    unit="%"
                  />
                </section>

                {/* Average speed (WPM) */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <MetricsChart
                    data={getDemoMetrics(session.started_at).wpm}
                    label="Average speed (WPM)"
                    yMin={100}
                    yMax={160}
                    unit=" wpm"
                  />
                </section>

                {/* Filler words */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <MetricsChart
                    data={getDemoMetrics(session.started_at).fillerRate}
                    label="Filler words (per min)"
                    yMin={0}
                    yMax={4}
                    unit="/min"
                  />
                </section>
              </div>
            )}
          </div>
        )}

        {/* Ratings */}
        {phase === "ratings" && (
          <div className="max-w-2xl mx-auto space-y-8">
            {!hasRatingsData ? (
              <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-10 text-center space-y-2">
                <p className="text-gray-300 font-medium">
                  No ratings data yet
                </p>
                <p className="text-sm text-gray-500">
                  Complete a session with your Cue glasses to see filler words,
                  speaking speed, audience retention, and overall rating here.
                </p>
                <Link
                  href={`/sessions/${sessionId}`}
                  className="inline-block mt-4 text-sm text-aqua hover:underline"
                >
                  View session details
                </Link>
              </div>
            ) : (
              <>
                {/* Overall */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">
                    Overall rating
                  </h2>
                  <p className="text-4xl font-bold text-aqua">
                    {session.overall_score != null
                      ? Math.round(session.overall_score)
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">out of 100</p>
                </section>

                {/* Per-part */}
                <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                  <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">
                    Per-part ratings
                  </h2>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">
                        Filler words
                      </p>
                      <p className="text-lg font-semibold text-gray-200">
                        {(session.summary as Record<string, unknown>)?.total_fillers != null
                          ? String(
                              (session.summary as Record<string, unknown>)
                                .total_fillers
                            )
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">
                        Avg. speed (WPM)
                      </p>
                      <p className="text-lg font-semibold text-gray-200">
                        {(session.summary as Record<string, unknown>)?.avg_wpm != null
                          ? Math.round(
                              (session.summary as Record<string, unknown>)
                                .avg_wpm as number
                            )
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">
                        Audience attention
                      </p>
                      <p className="text-lg font-semibold text-gray-200">
                        {(session.summary as Record<string, unknown>)?.avg_attention != null
                          ? `${Math.round((session.summary as Record<string, unknown>).avg_attention as number * 100)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                </section>

                {/* Major flags from report */}
                {reportLoading && (
                  <p className="text-sm text-gray-500">Loading report…</p>
                )}
                {report && report.report.areas_to_improve?.length > 0 && (
                  <section className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
                    <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">
                      Major flags
                    </h2>
                    <ul className="space-y-2">
                      {report.report.areas_to_improve.map((item, i) => (
                        <li
                          key={i}
                          className="text-sm text-gray-300 flex gap-2"
                        >
                          <span className="text-aqua shrink-0">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {report && (
                  <div className="flex gap-2">
                    <Link
                      href={`/sessions/${sessionId}/report`}
                      className="text-sm text-aqua hover:underline"
                    >
                      Full report →
                    </Link>
                    <Link
                      href={`/sessions/${sessionId}`}
                      className="text-sm text-gray-500 hover:text-aqua transition-colors"
                    >
                      Transcript & charts
                    </Link>
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
