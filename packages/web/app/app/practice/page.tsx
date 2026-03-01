"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listSessions, getCurrentUserId } from "../../../lib/supabase";
import { getSessionReport } from "../../../lib/api";
import type { Session } from "../../../lib/supabase";

// Demo skills when no session/report data
const DEMO_AREAS = [
  "Reduce filler words",
  "Vary your pace",
  "Stronger openings",
];
const DEMO_DRILLS = [
  "Practice pausing before key points",
  "Record yourself and count fillers",
];

type View = "pick-session" | "path" | "lesson";
type LessonStep = "intro" | "exercise" | "done";

interface Skill {
  id: string;
  title: string;
  tip: string;
  exercises: { question: string; options?: string[]; type: "choice" | "rating" }[];
}

function buildSkills(
  areas: string[],
  drills: string[]
): Skill[] {
  const tips: Record<string, string> = {
    "Reduce filler words":
      "Pause instead of saying 'um' or 'like'. A short silence feels more confident than fillers.",
    "Vary your pace":
      "Speed up for energy on lighter points; slow down when making a key claim or number.",
    "Stronger openings":
      "Start with a clear hook: a question, a number, or one bold sentence. Avoid 'So' or 'Okay'.",
    "Practice pausing before key points":
      "Before your main idea, take a full breath. It builds anticipation and sounds deliberate.",
    "Record yourself and count fillers":
      "Watch one minute of a recording and count fillers. Set a lower target each time.",
  };
  const defaultTip = "Focus on this area in your next session. Small, repeated practice works best.";
  const defaultExercises = [
    { question: "How often will you practice this week?", type: "choice" as const, options: ["Once", "2–3 times", "Daily"] },
    { question: "Rate your readiness to try this (1–5):", type: "rating" as const },
  ];

  const skillTitles = [...areas, ...drills];
  return skillTitles.map((title, i) => ({
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
  const [report, setReport] = useState<{
    areas_to_improve: string[];
    suggested_drills: string[];
  } | null>(null);
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
    listSessions(getCurrentUserId())
      .then((data) => setSessions(data ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setReport(null);
      setReportError(null);
      return;
    }
    setReportLoading(true);
    setReportError(null);
    getSessionReport(selectedSessionId)
      .then((r) =>
        setReport({
          areas_to_improve: r.report.areas_to_improve ?? [],
          suggested_drills: r.report.suggested_drills ?? [],
        })
      )
      .catch(() => {
        setReportError("Could not load report.");
        setReport(null);
      })
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

  const startPractice = () => {
    setView("path");
    setCurrentSkillIndex(0);
    setCompletedIds(new Set());
  };

  const openLesson = (index: number) => {
    setCurrentSkillIndex(index);
    setLessonStep("intro");
    setExerciseIndex(0);
    setSelectedOption(null);
    setShowCorrect(false);
    setView("lesson");
  };

  const handleNextExercise = () => {
    if (!currentSkill) return;
    const exs = currentSkill.exercises;
    if (exerciseIndex < exs.length - 1) {
      setExerciseIndex((i) => i + 1);
      setSelectedOption(null);
      setShowCorrect(false);
    } else {
      setCompletedIds((prev) => new Set(prev).add(currentSkill.id));
      setLessonStep("done");
    }
  };

  const handleLessonBack = () => {
    setView("path");
    setLessonStep("intro");
    setExerciseIndex(0);
    setSelectedOption(null);
  };

  if (view === "pick-session") {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href="/app" className="hover:text-aqua transition-colors">
              Sessions
            </Link>
            <span>/</span>
            <span className="text-gray-400">Practice</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Practice from session
          </h1>
          <p className="text-sm text-gray-500 mb-8">
            Select a session to unlock practice lessons based on your report. No session? We’ll use sample lessons.
          </p>

          <section className="mb-6">
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
              Select a session
            </h2>
            {loading ? (
              <p className="text-sm text-gray-500">Loading sessions…</p>
            ) : (
              <ul className="space-y-2">
                <li>
                  <button
                    onClick={() => {
                      setSelectedSessionId(null);
                      setReport(null);
                      setReportError(null);
                      setSkills(buildSkills(DEMO_AREAS, DEMO_DRILLS));
                    }}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                      selectedSessionId === null
                        ? "border-aqua bg-aqua/10 text-white"
                        : "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    Use sample lessons (no session)
                  </button>
                </li>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                        selectedSessionId === s.id
                          ? "border-aqua bg-aqua/10 text-white"
                          : "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      <span className="block font-medium">
                        {s.started_at
                          ? format(new Date(s.started_at), "MMM d, yyyy — h:mm a")
                          : "Session"}
                      </span>
                      {s.overall_score != null && (
                        <span className="block text-xs text-gray-500 mt-0.5">
                          Score: {Math.round(s.overall_score)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {reportLoading ? (
            <p className="text-sm text-gray-500">Loading report…</p>
          ) : (
            <button
              onClick={startPractice}
              disabled={skills.length === 0}
              className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Start practice
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === "path") {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <Link href="/app" className="hover:text-aqua transition-colors">
              Sessions
            </Link>
            <span>/</span>
            <button
              type="button"
              onClick={() => setView("pick-session")}
              className="hover:text-aqua transition-colors"
            >
              Practice
            </button>
          </div>

          {/* Progress bar - Duolingo style */}
          <div className="mb-8">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Your progress</span>
              <span>{completedCount} / {totalLessons} lessons</span>
            </div>
            <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-aqua transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <h2 className="text-xl font-bold text-white mb-6">Practice path</h2>
          <ul className="space-y-3">
            {skills.map((skill, i) => {
              const done = completedIds.has(skill.id);
              const locked = i > completedCount;
              return (
                <li key={skill.id}>
                  <button
                    onClick={() => !locked && openLesson(i)}
                    disabled={locked}
                    className={`w-full flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all ${
                      done
                        ? "border-green-500/50 bg-green-500/10 text-green-300"
                        : locked
                          ? "border-gray-700 bg-gray-900/30 text-gray-600 cursor-not-allowed"
                          : "border-aqua/50 bg-gray-900/50 text-white hover:border-aqua hover:bg-aqua/10"
                    }`}
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                        done
                          ? "bg-green-500/30 text-green-300"
                          : locked
                            ? "bg-gray-800 text-gray-600"
                            : "bg-aqua/20 text-aqua"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="font-medium">{skill.title}</span>
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
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20 text-4xl text-green-400">
              ✓
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Lesson complete!</h2>
            <p className="text-gray-400 mb-8">{currentSkill.title}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleLessonBack}
                className="rounded-xl border border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 transition-colors"
              >
                Back to path
              </button>
              {currentSkillIndex < skills.length - 1 && (
                <button
                  onClick={() => openLesson(currentSkillIndex + 1)}
                  className="rounded-xl bg-aqua px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
                >
                  Next lesson
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    const exercise = currentSkill.exercises[exerciseIndex];
    const isRating = exercise?.type === "rating";

    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto">
          <button
            type="button"
            onClick={handleLessonBack}
            className="text-sm text-gray-500 hover:text-aqua mb-6 inline-flex items-center gap-1"
          >
            ← Back to path
          </button>

          {lessonStep === "intro" && (
            <>
              <h1 className="text-2xl font-bold text-white mb-4">{currentSkill.title}</h1>
              <p className="text-gray-300 mb-8 leading-relaxed">{currentSkill.tip}</p>
              <button
                onClick={() => {
                  setLessonStep("exercise");
                  setExerciseIndex(0);
                  setSelectedOption(null);
                }}
                className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
              >
                Start exercises
              </button>
            </>
          )}

          {lessonStep === "exercise" && exercise && (
            <>
              <div className="mb-2 text-sm text-aqua font-medium">
                Exercise {exerciseIndex + 1} of {currentSkill.exercises.length}
              </div>
              <h2 className="text-xl font-bold text-white mb-6">{exercise.question}</h2>

              {exercise.options ? (
                <ul className="space-y-2">
                  {exercise.options.map((opt) => (
                    <li key={opt}>
                      <button
                        onClick={() => {
                          setSelectedOption(opt);
                          setShowCorrect(true);
                        }}
                        className={`w-full rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                          selectedOption === opt
                            ? "border-aqua bg-aqua/10 text-white"
                            : "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600"
                        }`}
                      >
                        {opt}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : isRating ? (
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setSelectedOption(n);
                        setShowCorrect(true);
                      }}
                      className={`h-12 w-12 rounded-xl border-2 text-lg font-semibold transition-colors ${
                        selectedOption === n
                          ? "border-aqua bg-aqua/10 text-white"
                          : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : null}

              {showCorrect && (
                <button
                  onClick={handleNextExercise}
                  className="mt-8 w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
                >
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
