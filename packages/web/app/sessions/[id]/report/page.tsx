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
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-indigo-600">Sessions</Link>
        <span>/</span>
        <Link href={`/sessions/${sessionId}`} className="hover:text-indigo-600">Session</Link>
        <span>/</span>
        <span className="text-gray-700">Report</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Coaching Report</h1>

      {state === "loading" && (
        <div className="flex flex-col items-center gap-4 py-16 text-gray-400">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Analysing session with Claude Sonnet…</p>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700 text-sm">
          {errorMsg}
        </div>
      )}

      {state === "done" && report && (
        <div className="space-y-8">
          {/* What went well */}
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-green-500">✓</span> What Went Well
            </h2>
            <ul className="space-y-2">
              {report.report.what_went_well.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="mt-0.5 text-green-400 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Areas to improve */}
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-yellow-500">↑</span> Areas to Improve
            </h2>
            <ul className="space-y-2">
              {report.report.areas_to_improve.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-700">
                  <span className="mt-0.5 text-yellow-400 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Fluency summary */}
          {report.report.fluency_summary && (
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Fluency</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                {report.report.fluency_summary}
              </p>
            </section>
          )}

          {/* Key moments */}
          {report.report.key_moments?.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Key Moments to Rewatch</h2>
              <ul className="space-y-2">
                {report.report.key_moments.map((m, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm"
                  >
                    <span className="font-mono text-gray-400 shrink-0">{m.timestamp}</span>
                    <span className="text-gray-700">{m.observation}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suggested drills */}
          {report.report.suggested_drills?.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Suggested Practice Drills</h2>
              <ol className="space-y-2 list-decimal list-inside">
                {report.report.suggested_drills.map((drill, i) => (
                  <li key={i} className="text-sm text-gray-700">
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
