"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listSessions, getCurrentUserId } from "../../../lib/supabase";
import { getSessionReport } from "../../../lib/api";
import type { Session } from "../../../lib/supabase";

const DEMO_AREAS = ["Reduce filler words", "Vary your pace", "Stronger openings"];
const DEMO_DRILLS = ["Practice pausing before key points", "Record yourself and count fillers"];

type View = "pick-session" | "path" | "lesson";
type LessonStep = "intro" | "exercise" | "done";

interface Skill {
  id: string;
  title: string;
  tip: string;
  exercises: { question: string; options?: string[]; type: "choice" | "rating" }[];
}

function buildSkills(areas: string[], drills: string[]): Skill[] {
  const tips: Record<string, string> = {
    "Reduce filler words": "Pause instead of saying 'um' or 'like'. A short silence feels more confident than fillers.",
    "Vary your pace": "Speed up for energy on lighter points; slow down when making a key claim or number.",
    "Stronger openings": "Start with a clear hook: a question, a number, or one bold sentence. Avoid 'So' or 'Okay'.",
    "Practice pausing before key points": "Before your main idea, take a full breath. It builds anticipation and sounds deliberate.",
    "Record yourself and count fillers": "Watch one minute of a recording and count fillers. Set a lower target each time.",
  };
  const defaultTip = "Focus on this area in your next session. Small, repeated practice works best.";
  const defaultExercises = [
    { question: "How often will you practice this week?", type: "choice" as const, options: ["Once", "2–3 times", "Daily"] },
    { question: "Rate your readiness to try this (1–5):", type: "rating" as const },
  ];

  return [...areas, ...drills].map((title, i) => ({
    id: `skill-${i}`,
    title,
    tip: tips[title] ?? defaultTip,
    exercises: [
      { question: `What's one thing you'll do for "${title}"?`, type: "choice" as const, options: ["Practice once before next talk", "Record and review", "Focus on it in the next session"] },
      ...defaultExercises,
    ],
  }));
}

export default function PracticePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [report, setReport] = useState<{ areas_to_improve: string[]; suggested_drills: string[] } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [view, setView] = useState<View>("pick-session");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [currentSkillIndex, setCurrentSkillIndex] = useState(0);
  const [lessonStep, setLessonStep] = useState<LessonStep>("intro");
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | number | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);

  useEffect(() => {
    listSessions(getCurrentUserId()).then((data) => setSessions(data ?? [])).catch(() => setSessions([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSessionId) { setReport(null); setReportError(null); return; }
    setReportLoading(true); setReportError(null);
    getSessionReport(selectedSessionId)
      .then((r) => setReport({ areas_to_improve: r.report.areas_to_improve ?? [], suggested_drills: r.report.suggested_drills ?? [] }))
      .catch(() => { setReportError("Could not load report."); setReport(null); })
      .finally(() => setReportLoading(false));
  }, [selectedSessionId]);

  useEffect(() => {
    if (report && (report.areas_to_improve.length > 0 || report.suggested_drills.length > 0)) {
      setSkills(buildSkills(report.areas_to_improve, report.suggested_drills));
    } else if (!reportLoading && (reportError || (report && report.areas_to_improve.length === 0 && report.suggested_drills.length === 0))) {
      setSkills(buildSkills(DEMO_AREAS, DEMO_DRILLS));
    }
  }, [report, reportLoading, reportError]);

  const currentSkill = skills[currentSkillIndex];
  const totalLessons = skills.length;
  const completedCount = completedIds.size;
  const progressPct = totalLessons ? (completedCount / totalLessons) * 100 : 0;

  const startPractice = () => { setView("path"); setCurrentSkillIndex(0); setCompletedIds(new Set()); };
  const openLesson = (index: number) => { setCurrentSkillIndex(index); setLessonStep("intro"); setExerciseIndex(0); setSelectedOption(null); setShowCorrect(false); setView("lesson"); };
  const handleNextExercise = () => {
    if (!currentSkill) return;
    if (exerciseIndex < currentSkill.exercises.length - 1) { setExerciseIndex((i) => i + 1); setSelectedOption(null); setShowCorrect(false); }
    else { setCompletedIds((prev) => new Set(prev).add(currentSkill.id)); setLessonStep("done"); }
  };
  const handleLessonBack = () => { setView("path"); setLessonStep("intro"); setExerciseIndex(0); setSelectedOption(null); };

  const breadcrumb = (
    <div className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", marginBottom: "24px" }}>
      <Link href="/app" style={{ color: "rgba(240,245,243,0.4)" }}>Sessions</Link>
      <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
      {view !== "pick-session" ? (
        <button type="button" onClick={() => setView("pick-session")} style={{ color: "rgba(240,245,243,0.4)", background: "none", border: "none", cursor: "pointer" }}>Practice</button>
      ) : (
        <span style={{ color: "rgba(240,245,243,0.6)" }}>Practice</span>
      )}
    </div>
  );

  if (view === "pick-session") {
    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: "640px", margin: "0 auto" }} className="fade-in-up">
          {breadcrumb}
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, marginBottom: "8px" }}>Practice</h1>
          <p style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "rgba(240,245,243,0.5)", marginBottom: "32px" }}>
            Select a session to unlock lessons based on your coaching report, or use sample lessons.
          </p>

          <section style={{ marginBottom: "24px" }}>
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>Select a session</p>
            {loading ? (
              <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>Loading sessions…</p>
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <li>
                  <button
                    onClick={() => { setSelectedSessionId(null); setReport(null); setReportError(null); setSkills(buildSkills(DEMO_AREAS, DEMO_DRILLS)); }}
                    className="feature-card w-full text-left"
                    style={{ padding: "12px 16px", fontSize: "0.875rem", borderColor: selectedSessionId === null ? "rgba(45,255,192,0.5)" : undefined, background: selectedSessionId === null ? "rgba(45,255,192,0.08)" : undefined, color: "var(--fg)" }}
                  >
                    Use sample lessons (no session)
                  </button>
                </li>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedSessionId(s.id)}
                      className="feature-card w-full text-left"
                      style={{ padding: "12px 16px", borderColor: selectedSessionId === s.id ? "rgba(45,255,192,0.5)" : undefined, background: selectedSessionId === s.id ? "rgba(45,255,192,0.08)" : undefined }}
                    >
                      <span style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", color: "var(--fg)" }}>
                        {s.started_at ? format(new Date(s.started_at), "MMM d, yyyy — h:mm a") : "Session"}
                      </span>
                      {s.overall_score != null && (
                        <span style={{ display: "block", fontSize: "0.7rem", color: "rgba(240,245,243,0.3)", marginTop: "2px" }}>Score: {Math.round(s.overall_score)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {reportLoading ? (
            <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>Loading report…</p>
          ) : (
            <button onClick={startPractice} disabled={skills.length === 0} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px" }}>
              Start practice
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === "path") {
    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          {breadcrumb}

          {/* Progress */}
          <div style={{ marginBottom: "32px" }}>
            <div className="flex justify-between" style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "8px" }}>
              <span>Progress</span>
              <span>{completedCount} / {totalLessons}</span>
            </div>
            <div style={{ height: "4px", borderRadius: "999px", background: "rgba(240,245,243,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: "999px", background: "var(--aqua)", transition: "width 0.5s", width: `${progressPct}%` }} />
            </div>
          </div>

          <h2 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "20px" }}>Practice path</h2>
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {skills.map((skill, i) => {
              const done = completedIds.has(skill.id);
              const locked = i > completedCount;
              return (
                <li key={skill.id}>
                  <button
                    onClick={() => !locked && openLesson(i)}
                    disabled={locked}
                    className="feature-card w-full flex items-center"
                    style={{
                      gap: "16px",
                      padding: "16px 20px",
                      textAlign: "left",
                      borderColor: done ? "rgba(45,255,192,0.3)" : locked ? "rgba(240,245,243,0.05)" : undefined,
                      background: done ? "rgba(45,255,192,0.05)" : locked ? "rgba(240,245,243,0.02)" : undefined,
                      opacity: locked ? 0.4 : 1,
                      cursor: locked ? "not-allowed" : "pointer",
                    }}
                  >
                    <span style={{ width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.875rem", fontWeight: 700, background: done ? "rgba(45,255,192,0.15)" : locked ? "rgba(240,245,243,0.05)" : "rgba(45,255,192,0.1)", color: done || !locked ? "var(--aqua)" : "rgba(240,245,243,0.3)" }}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem", color: locked ? "rgba(240,245,243,0.3)" : "var(--fg)" }}>{skill.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  // Lesson view
  if (view === "lesson" && currentSkill) {
    if (lessonStep === "done") {
      return (
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center" style={{ padding: "40px 24px" }}>
          <div className="fade-in-up text-center" style={{ maxWidth: "400px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "rgba(45,255,192,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem", color: "var(--aqua)" }}>✓</div>
            <h2 style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.04em" }}>Lesson complete</h2>
            <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.5)" }}>{currentSkill.title}</p>
            <div className="flex" style={{ gap: "12px", marginTop: "8px" }}>
              <button onClick={handleLessonBack} className="btn-pill btn-ghost" style={{ padding: "10px 20px" }}>Back to path</button>
              {currentSkillIndex < skills.length - 1 && (
                <button onClick={() => openLesson(currentSkillIndex + 1)} className="btn-pill btn-primary" style={{ padding: "10px 20px" }}>Next lesson</button>
              )}
            </div>
          </div>
        </div>
      );
    }

    const exercise = currentSkill.exercises[exerciseIndex];
    const isRating = exercise?.type === "rating";

    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <button type="button" onClick={handleLessonBack} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", background: "none", border: "none", cursor: "pointer", marginBottom: "24px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
            ← Back to path
          </button>

          {lessonStep === "intro" && (
            <>
              <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "16px" }}>{currentSkill.title}</h1>
              <p style={{ fontSize: "1rem", lineHeight: 1.8, color: "rgba(240,245,243,0.6)", marginBottom: "32px" }}>{currentSkill.tip}</p>
              <button onClick={() => { setLessonStep("exercise"); setExerciseIndex(0); setSelectedOption(null); }} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px" }}>
                Start exercises
              </button>
            </>
          )}

          {lessonStep === "exercise" && exercise && (
            <>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--aqua)", fontWeight: 600, marginBottom: "8px" }}>
                Exercise {exerciseIndex + 1} of {currentSkill.exercises.length}
              </p>
              <h2 style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "24px" }}>{exercise.question}</h2>

              {exercise.options ? (
                <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {exercise.options.map((opt) => (
                    <li key={opt}>
                      <button
                        onClick={() => { setSelectedOption(opt); setShowCorrect(true); }}
                        className="feature-card w-full text-left"
                        style={{ padding: "12px 16px", fontSize: "0.875rem", borderColor: selectedOption === opt ? "rgba(45,255,192,0.5)" : undefined, background: selectedOption === opt ? "rgba(45,255,192,0.08)" : undefined, color: "var(--fg)" }}
                      >
                        {opt}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : isRating ? (
                <div className="flex flex-wrap" style={{ gap: "8px" }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => { setSelectedOption(n); setShowCorrect(true); }}
                      style={{ width: "48px", height: "48px", borderRadius: "12px", border: `1px solid ${selectedOption === n ? "rgba(45,255,192,0.5)" : "rgba(45,255,192,0.12)"}`, background: selectedOption === n ? "rgba(45,255,192,0.1)" : "rgba(240,245,243,0.03)", fontSize: "0.875rem", fontWeight: 700, color: selectedOption === n ? "var(--aqua)" : "rgba(240,245,243,0.5)", cursor: "pointer", transition: "all 0.15s" }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : null}

              {showCorrect && (
                <button onClick={handleNextExercise} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px", marginTop: "32px" }}>
                  {exerciseIndex < currentSkill.exercises.length - 1 ? "Next" : "Complete lesson"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
