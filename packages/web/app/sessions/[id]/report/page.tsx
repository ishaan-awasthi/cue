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
      .then((r) => { setReport(r); setState("done"); })
      .catch((err) => { setErrorMsg(err instanceof Error ? err.message : "Failed to generate report"); setState("error"); });
  }, [sessionId]);

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 16px", background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", marginBottom: "32px" }}>
        <Link href="/app" style={{ color: "rgba(240,245,243,0.4)" }}>Sessions</Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <Link href={`/sessions/${sessionId}`} style={{ color: "rgba(240,245,243,0.4)" }}>Session</Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <span style={{ color: "rgba(240,245,243,0.6)" }}>Report</span>
      </div>

      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, marginBottom: "32px" }}>
        Coaching report
      </h1>

      {state === "loading" && (
        <div className="flex flex-col items-center" style={{ gap: "16px", padding: "64px 0", color: "rgba(240,245,243,0.4)" }}>
          <div style={{ width: "28px", height: "28px", border: "2px solid var(--aqua)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: "0.875rem" }}>Analysing session…</p>
        </div>
      )}

      {state === "error" && (
        <div className="feature-card" style={{ padding: "24px", color: "rgba(240,245,243,0.6)", fontSize: "0.875rem" }}>{errorMsg}</div>
      )}

      {state === "done" && report && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <section className="feature-card">
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>What went well</p>
            <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {report.report.what_went_well.map((item, i) => (
                <li key={i} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", display: "flex", gap: "8px" }}>
                  <span style={{ color: "var(--aqua)", flexShrink: 0 }}>—</span>{item}
                </li>
              ))}
            </ul>
          </section>

          <section className="feature-card">
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>Areas to improve</p>
            <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {report.report.areas_to_improve.map((item, i) => (
                <li key={i} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", display: "flex", gap: "8px" }}>
                  <span style={{ color: "var(--aqua)", flexShrink: 0 }}>—</span>{item}
                </li>
              ))}
            </ul>
          </section>

          {report.report.fluency_summary && (
            <section className="feature-card">
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>Fluency</p>
              <p style={{ fontSize: "0.9rem", lineHeight: 1.8, color: "rgba(240,245,243,0.6)" }}>{report.report.fluency_summary}</p>
            </section>
          )}

          {report.report.key_moments?.length > 0 && (
            <section className="feature-card">
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>Key moments</p>
              <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {report.report.key_moments.map((m, i) => (
                  <li key={i} style={{ display: "flex", gap: "12px", border: "1px solid rgba(45,255,192,0.1)", borderRadius: "12px", padding: "12px 16px", fontSize: "0.875rem" }}>
                    <span style={{ fontFamily: "monospace", color: "rgba(240,245,243,0.3)", flexShrink: 0 }}>{m.timestamp}</span>
                    <span style={{ color: "rgba(240,245,243,0.7)" }}>{m.observation}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.report.suggested_drills?.length > 0 && (
            <section className="feature-card">
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "16px" }}>Suggested drills</p>
              <ol style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {report.report.suggested_drills.map((drill, i) => (
                  <li key={i} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", display: "flex", gap: "8px" }}>
                    <span style={{ color: "var(--aqua)", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>{drill}
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
