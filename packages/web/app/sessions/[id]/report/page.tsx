"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSessionReport, type CoachingReport } from "../../../../lib/api";

type ReportState = "idle" | "loading" | "done" | "error";

export default function ReportPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [state, setState] = useState<ReportState>("idle");
  const [report, setReport] = useState<CoachingReport | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setState("loading");
    getSessionReport(sessionId)
      .then((r) => {
        setReport(r);
        setState("done");
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Failed to generate report");
        setState("error");
      });
  }, [sessionId]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 bg-gray-950 text-gray-100 min-h-screen">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/app" className="hover:text-aqua transition-colors">Sessions</Link>
        <span>/</span>
        <Link href={`/sessions/${sessionId}`} className="hover:text-aqua transition-colors">Session</Link>
        <span>/</span>
        <span className="text-gray-400">Report</span>
      </div>

      <h1 className="text-2xl font-bold text-white mb-6">Coaching Report</h1>

      {state === "loading" && (
        <div className="flex flex-col items-center gap-4 py-16 text-gray-500">
          <div className="w-8 h-8 border-2 border-aqua border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Analysing session…</p>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-xl border border-gray-600 bg-gray-800/50 p-6 text-gray-300 text-sm">
          {errorMsg}
        </div>
      )}

      {state === "done" && report && (
        <div className="space-y-8">
          {/* What went well */}
          <section>
            <h2 className="text-lg font-semibold text-gray-200 mb-3 flex items-center gap-2">
              <span className="text-aqua">✓</span> What Went Well
            </h2>
            <ul className="space-y-2">
              {report.report.what_went_well.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300">
                  <span className="mt-0.5 text-aqua shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Areas to improve */}
          <section>
            <h2 className="text-lg font-semibold text-gray-200 mb-3 flex items-center gap-2">
              <span className="text-aqua">↑</span> Areas to Improve
            </h2>
            <ul className="space-y-2">
              {report.report.areas_to_improve.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300">
                  <span className="mt-0.5 text-aqua shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Fluency summary */}
          {report.report.fluency_summary && (
            <section>
              <h2 className="text-lg font-semibold text-gray-200 mb-3">Fluency</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                {report.report.fluency_summary}
              </p>
            </section>
          )}

          {/* Key moments */}
          {report.report.key_moments?.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-200 mb-3">Key Moments to Rewatch</h2>
              <ul className="space-y-2">
                {report.report.key_moments.map((m, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3 text-sm"
                  >
                    <span className="font-mono text-gray-500 shrink-0">{m.timestamp}</span>
                    <span className="text-gray-300">{m.observation}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suggested drills */}
          {report.report.suggested_drills?.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-200 mb-3">Suggested Practice Drills</h2>
              <ol className="space-y-2 list-decimal list-inside">
                {report.report.suggested_drills.map((drill, i) => (
                  <li key={i} className="text-sm text-gray-300">
                    {drill}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
