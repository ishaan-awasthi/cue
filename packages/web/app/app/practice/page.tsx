"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listSessions, getCurrentUserId } from "../../../lib/supabase";
import { getSessionReport, analyzePracticeDrill } from "../../../lib/api";
import type { Session } from "../../../lib/supabase";
import type { PracticeNudge, PracticeAnalyzeResult } from "../../../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// SpeechRecognition is not always in older TS dom lib versions — declare locally
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeakingDrill {
  type: "speaking";
  id: string;
  title: string;
  description: string;
  prompt: string;
  durationSeconds: number;
  tip: string;
}

interface QuizDrill {
  type: "quiz";
  id: string;
  title: string;
  description: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

type Drill = SpeakingDrill | QuizDrill;

type View = "pick-session" | "path" | "lesson" | "complete";

// ---------------------------------------------------------------------------
// Default drills
// ---------------------------------------------------------------------------

const DEMO_DRILLS: Drill[] = [
  {
    type: "speaking",
    id: "d-1",
    title: "The 60-second hook",
    description: "Open strong in under a minute.",
    prompt: "Introduce yourself and your main idea as if you have 60 seconds on stage. Make every word count.",
    durationSeconds: 60,
    tip: "Start with a bold claim or question — not 'So today I want to talk about…'",
  },
  {
    type: "quiz",
    id: "d-2",
    title: "Filler word awareness",
    description: "Test your knowledge of common fillers.",
    question: "Which of the following is the best strategy when you feel the urge to say 'um'?",
    options: [
      "Say 'um' quietly so it's less noticeable",
      "Pause silently — a beat of silence sounds confident",
      "Speak faster to fill the gap",
      "Clear your throat instead",
    ],
    correctIndex: 1,
    explanation: "A deliberate pause signals confidence and gives the audience time to absorb what you said. Silence is a tool, not a flaw.",
  },
  {
    type: "speaking",
    id: "d-3",
    title: "Vary your pace",
    description: "Practice slowing down for impact.",
    prompt: "Describe a challenge you overcame. Speed up on the background details; slow down and pause before the key lesson.",
    durationSeconds: 90,
    tip: "Pace changes signal importance. Slow = this matters. Fast = background info.",
  },
  {
    type: "quiz",
    id: "d-4",
    title: "Ideal speaking pace",
    description: "Know your target WPM range.",
    question: "What is the generally recommended speaking pace for a presentation?",
    options: [
      "80–100 words per minute",
      "110–160 words per minute",
      "170–200 words per minute",
      "200+ words per minute",
    ],
    correctIndex: 1,
    explanation: "110–160 WPM is the sweet spot: fast enough to feel energetic, slow enough to be understood clearly.",
  },
  {
    type: "speaking",
    id: "d-5",
    title: "Handle a tough question",
    description: "Stay calm under pressure.",
    prompt: "Someone just asked you a question you don't fully know the answer to. Respond honestly and confidently in under 45 seconds.",
    durationSeconds: 45,
    tip: "It's okay to say 'I don't know the full answer, but here's what I do know…' — audiences respect honesty.",
  },
];

// ---------------------------------------------------------------------------
// Filler counting (mirrors backend)
// ---------------------------------------------------------------------------

const FILLER_UNIGRAMS = new Set(["uh", "um", "hmm", "er", "erm", "like", "so", "basically", "literally", "actually"]);
const FILLER_BIGRAMS = ["you know", "i mean", "kind of", "sort of", "you see"];

function countFillers(transcript: string): { count: number; found: string[] } {
  let text = transcript.toLowerCase();
  const found: string[] = [];
  let count = 0;
  for (const bigram of FILLER_BIGRAMS) {
    const re = new RegExp(`\\b${bigram.replace(/ /g, "\\s+")}\\b`, "g");
    const matches = text.match(re);
    if (matches) {
      found.push(bigram);
      count += matches.length;
      text = text.replace(re, " _ ");
    }
  }
  for (const word of text.split(/\s+/)) {
    const clean = word.replace(/[^a-z]/g, "");
    if (FILLER_UNIGRAMS.has(clean)) {
      if (!found.includes(clean)) found.push(clean);
      count++;
    }
  }
  return { count, found };
}

// ---------------------------------------------------------------------------
// buildDrillsFromReport
// ---------------------------------------------------------------------------

function buildDrillsFromReport(areas: string[], _drills: string[]): Drill[] {
  return DEMO_DRILLS;
}

// ---------------------------------------------------------------------------
// useSpeechRecorder hook
// ---------------------------------------------------------------------------

type RecordStatus = "idle" | "recording" | "done";

interface RecorderState {
  status: RecordStatus;
  liveTranscript: string;
  finalTranscript: string;
  wordCount: number;
  fillerCount: number;
  durationSeconds: number;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

function useSpeechRecorder(): RecorderState {
  const [status, setStatus] = useState<RecordStatus>("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [fillerCount, setFillerCount] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalRef = useRef("");
  const startTimeRef = useRef<number>(0);

  const start = useCallback(() => {
    const SpeechRecognitionCtor = (
      (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
      (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
    );
    if (!SpeechRecognitionCtor) {
      alert("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }
    const recog = new SpeechRecognitionCtor();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = "en-US";
    finalRef.current = "";
    startTimeRef.current = Date.now();

    recog.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalRef.current += r[0].transcript + " ";
        } else {
          interim += r[0].transcript;
        }
      }
      setFinalTranscript(finalRef.current);
      setLiveTranscript(finalRef.current + interim);
    };

    recog.start();
    recogRef.current = recog;
    setStatus("recording");
  }, []);

  const stop = useCallback(() => {
    if (recogRef.current) {
      recogRef.current.stop();
      recogRef.current = null;
    }
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const text = finalRef.current.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const { count } = countFillers(text);
    setWordCount(words);
    setFillerCount(count);
    setDurationSeconds(elapsed);
    setFinalTranscript(text);
    setLiveTranscript(text);
    setStatus("done");
  }, []);

  const reset = useCallback(() => {
    if (recogRef.current) {
      recogRef.current.abort();
      recogRef.current = null;
    }
    finalRef.current = "";
    setStatus("idle");
    setLiveTranscript("");
    setFinalTranscript("");
    setWordCount(0);
    setFillerCount(0);
    setDurationSeconds(0);
  }, []);

  return { status, liveTranscript, finalTranscript, wordCount, fillerCount, durationSeconds, start, stop, reset };
}

// ---------------------------------------------------------------------------
// ScoreRing
// ---------------------------------------------------------------------------

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "var(--aqua)" : score >= 60 ? "#9ca3af" : "#6b7280";
  const r = 40;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  return (
    <svg width="120" height="120" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(240,245,243,0.06)" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="18" fontWeight="900">
        {Math.round(score)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SpeakingLesson
// ---------------------------------------------------------------------------

function SpeakingLesson({ drill, onComplete }: { drill: SpeakingDrill; onComplete: (score: number) => void }) {
  const recorder = useSpeechRecorder();
  const [timeLeft, setTimeLeft] = useState(drill.durationSeconds);
  const [result, setResult] = useState<PracticeAnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Auto-stop timer
  useEffect(() => {
    if (recorder.status !== "recording") return;
    setTimeLeft(drill.durationSeconds);
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { recorder.stop(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [recorder.status, drill.durationSeconds, recorder.stop]);

  // Analyze when done
  useEffect(() => {
    if (recorder.status !== "done" || result) return;
    setAnalyzing(true);
    const wpm = recorder.durationSeconds > 0
      ? (recorder.wordCount / recorder.durationSeconds) * 60
      : 0;
    analyzePracticeDrill({
      transcript: recorder.finalTranscript,
      words_per_minute: wpm,
      filler_word_count: recorder.fillerCount,
      duration_seconds: recorder.durationSeconds,
    })
      .then(setResult)
      .catch(() => {
        const wpmInRange = wpm >= 110 && wpm <= 160;
        const fallbackScore = Math.max(0, Math.min(100, 80 - recorder.fillerCount * 5 + (wpmInRange ? 10 : 0)));
        setResult({
          score: fallbackScore,
          nudges: [],
          filler_words_found: countFillers(recorder.finalTranscript).found,
          wpm,
        });
      })
      .finally(() => setAnalyzing(false));
  }, [recorder.status, result]);

  const progressPct = ((drill.durationSeconds - timeLeft) / drill.durationSeconds) * 100;

  if (recorder.status === "idle") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Tip card */}
        <div className="feature-card" style={{ padding: "16px 20px", borderColor: "rgba(45,255,192,0.2)" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--aqua)", fontWeight: 600, marginBottom: "6px" }}>Tip</p>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", lineHeight: 1.6 }}>{drill.tip}</p>
        </div>
        {/* Prompt card */}
        <div className="feature-card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "10px" }}>Your prompt</p>
          <p style={{ fontSize: "1rem", lineHeight: 1.7, color: "var(--fg)" }}>{drill.prompt}</p>
        </div>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,245,243,0.4)", textAlign: "center" }}>
          {drill.durationSeconds}s drill · click Start when ready
        </p>
        <button onClick={recorder.start} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px" }}>
          Start recording
        </button>
      </div>
    );
  }

  if (recorder.status === "recording") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Progress bar */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "rgba(240,245,243,0.4)", marginBottom: "6px" }}>
            <span style={{ color: "var(--aqua)", fontWeight: 600 }}>Recording…</span>
            <span>{timeLeft}s left</span>
          </div>
          <div style={{ height: "4px", borderRadius: "999px", background: "rgba(240,245,243,0.06)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: "999px", background: "var(--aqua)", transition: "width 1s linear", width: `${progressPct}%` }} />
          </div>
        </div>
        {/* Live transcript */}
        <div className="feature-card" style={{ padding: "16px 20px", minHeight: "80px" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.3)", fontWeight: 600, marginBottom: "8px" }}>Live transcript</p>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.6)", lineHeight: 1.6 }}>
            {recorder.liveTranscript || <span style={{ opacity: 0.3 }}>Listening…</span>}
          </p>
        </div>
        <button onClick={recorder.stop} className="btn-pill btn-ghost w-full" style={{ padding: "12px 24px" }}>
          Stop early
        </button>
      </div>
    );
  }

  // done
  if (analyzing) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(240,245,243,0.4)", fontSize: "0.875rem" }}>
        Analyzing your response…
      </div>
    );
  }

  if (result) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Score */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <ScoreRing score={result.score} />
          <div>
            <p style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em" }}>{Math.round(result.score)}/100</p>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,245,243,0.4)", marginTop: "2px" }}>
              {result.wpm > 0 ? `${Math.round(result.wpm)} WPM` : ""}
            </p>
          </div>
        </div>

        {/* Nudges */}
        {result.nudges.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {result.nudges.map((n: PracticeNudge, i: number) => (
              <div key={i} className="feature-card" style={{ padding: "12px 16px", borderColor: "rgba(251,191,36,0.2)", background: "rgba(251,191,36,0.05)" }}>
                <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.8)", lineHeight: 1.5 }}>{n.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filler chips */}
        {result.filler_words_found.length > 0 && (
          <div>
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "8px" }}>Fillers detected</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {result.filler_words_found.map((w: string) => (
                <span key={w} style={{ padding: "4px 10px", borderRadius: "999px", border: "1px solid rgba(240,245,243,0.1)", fontSize: "0.75rem", color: "rgba(240,245,243,0.5)" }}>{w}</span>
              ))}
            </div>
          </div>
        )}

        {/* Transcript */}
        {recorder.finalTranscript && (
          <div className="feature-card" style={{ padding: "16px 20px" }}>
            <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.3)", fontWeight: 600, marginBottom: "8px" }}>Your transcript</p>
            <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.6)", lineHeight: 1.6 }}>{recorder.finalTranscript}</p>
          </div>
        )}

        <button onClick={() => onComplete(result.score)} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px" }}>
          Complete lesson
        </button>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// QuizLesson
// ---------------------------------------------------------------------------

function QuizLesson({ drill, onComplete }: { drill: QuizDrill; onComplete: (score: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);

  const isCorrect = selected === drill.correctIndex;
  const score = isCorrect ? 100 : 60;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <p style={{ fontSize: "1rem", lineHeight: 1.7, color: "var(--fg)", fontWeight: 600 }}>{drill.question}</p>

      <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {drill.options.map((opt, i) => {
          let borderColor = "rgba(45,255,192,0.12)";
          let bg = "rgba(240,245,243,0.03)";
          if (selected !== null) {
            if (i === drill.correctIndex) { borderColor = "rgba(34,197,94,0.6)"; bg = "rgba(34,197,94,0.1)"; }
            else if (i === selected) { borderColor = "rgba(239,68,68,0.6)"; bg = "rgba(239,68,68,0.1)"; }
          }
          return (
            <li key={i}>
              <button
                disabled={selected !== null}
                onClick={() => setSelected(i)}
                className="feature-card w-full text-left"
                style={{ padding: "12px 16px", fontSize: "0.875rem", borderColor, background: bg, color: "var(--fg)", cursor: selected !== null ? "default" : "pointer" }}
              >
                {opt}
              </button>
            </li>
          );
        })}
      </ul>

      {selected !== null && (
        <>
          <div className="feature-card" style={{ padding: "12px 16px", borderColor: isCorrect ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)", background: isCorrect ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: isCorrect ? "#4ade80" : "#f87171", marginBottom: "4px" }}>
              {isCorrect ? "Correct!" : "Not quite"}
            </p>
            <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.7)", lineHeight: 1.5 }}>{drill.explanation}</p>
          </div>
          <button onClick={() => onComplete(score)} className="btn-pill btn-primary w-full" style={{ padding: "14px 24px" }}>
            Complete lesson
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LessonComplete
// ---------------------------------------------------------------------------

function LessonComplete({ score, drill, onNext, onBack, hasNext }: { score: number; drill: Drill; onNext: () => void; onBack: () => void; hasNext: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center" style={{ padding: "40px 24px" }}>
      <div className="fade-in-up text-center" style={{ maxWidth: "400px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <ScoreRing score={score} />
        <h2 style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.04em" }}>Lesson complete</h2>
        <p style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.5)" }}>{drill.title}</p>
        <div className="flex" style={{ gap: "12px", marginTop: "8px" }}>
          <button onClick={onBack} className="btn-pill btn-ghost" style={{ padding: "10px 20px" }}>Back to path</button>
          {hasNext && (
            <button onClick={onNext} className="btn-pill btn-primary" style={{ padding: "10px 20px" }}>Next lesson</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PracticePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [view, setView] = useState<View>("pick-session");
  const [drills, setDrills] = useState<Drill[]>(DEMO_DRILLS);
  const [completedScores, setCompletedScores] = useState<Record<string, number>>({});
  const [currentDrillIndex, setCurrentDrillIndex] = useState(0);
  const [lastScore, setLastScore] = useState(0);

  const completedCount = Object.keys(completedScores).length;
  const totalDrills = drills.length;
  const progressPct = totalDrills ? (completedCount / totalDrills) * 100 : 0;

  useEffect(() => {
    listSessions(getCurrentUserId())
      .then((data) => setSessions(data ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const loadSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    if (!sessionId) { setDrills(DEMO_DRILLS); return; }
    setReportLoading(true);
    getSessionReport(sessionId)
      .then((r) => {
        const built = buildDrillsFromReport(r.report.areas_to_improve ?? [], r.report.suggested_drills ?? []);
        setDrills(built.length ? built : DEMO_DRILLS);
      })
      .catch(() => setDrills(DEMO_DRILLS))
      .finally(() => setReportLoading(false));
  }, []);

  const openLesson = (index: number) => {
    setCurrentDrillIndex(index);
    setView("lesson");
  };

  const handleComplete = (score: number) => {
    const drill = drills[currentDrillIndex];
    setLastScore(score);
    setCompletedScores((prev) => ({ ...prev, [drill.id]: score }));
    setView("complete");
  };

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

  // ── pick-session ─────────────────────────────────────────────────────────
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
                    onClick={() => loadSession(null)}
                    className="feature-card w-full text-left"
                    style={{ padding: "12px 16px", fontSize: "0.875rem", borderColor: selectedSessionId === null ? "rgba(45,255,192,0.5)" : undefined, background: selectedSessionId === null ? "rgba(45,255,192,0.08)" : undefined, color: "var(--fg)" }}
                  >
                    Use sample lessons (no session)
                  </button>
                </li>
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => loadSession(s.id)}
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
            <button
              onClick={() => { setCompletedScores({}); setView("path"); }}
              className="btn-pill btn-primary w-full"
              style={{ padding: "14px 24px" }}
            >
              Start practice
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── path ──────────────────────────────────────────────────────────────────
  if (view === "path") {
    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          {breadcrumb}

          <div style={{ marginBottom: "32px" }}>
            <div className="flex justify-between" style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "8px" }}>
              <span>Progress</span>
              <span>{completedCount} / {totalDrills}</span>
            </div>
            <div style={{ height: "4px", borderRadius: "999px", background: "rgba(240,245,243,0.06)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: "999px", background: "var(--aqua)", transition: "width 0.5s", width: `${progressPct}%` }} />
            </div>
          </div>

          <h2 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "20px" }}>Practice path</h2>
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {drills.map((drill, i) => {
              const done = drill.id in completedScores;
              const drillScore = completedScores[drill.id];
              return (
                <li key={drill.id}>
                  <button
                    onClick={() => openLesson(i)}
                    className="feature-card w-full flex items-center"
                    style={{
                      gap: "16px",
                      padding: "16px 20px",
                      textAlign: "left",
                      borderColor: done ? "rgba(45,255,192,0.3)" : undefined,
                      background: done ? "rgba(45,255,192,0.05)" : undefined,
                    }}
                  >
                    <span style={{ width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "0.875rem", fontWeight: 700, background: done ? "rgba(45,255,192,0.15)" : "rgba(45,255,192,0.1)", color: "var(--aqua)" }}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: "0.9rem", color: "var(--fg)" }}>{drill.title}</span>
                      <span style={{ display: "block", fontSize: "0.75rem", color: "rgba(240,245,243,0.35)", marginTop: "2px" }}>{drill.description}</span>
                    </span>
                    {done && drillScore != null && (
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--aqua)" }}>{Math.round(drillScore)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  // ── lesson ────────────────────────────────────────────────────────────────
  if (view === "lesson") {
    const drill = drills[currentDrillIndex];
    return (
      <div className="flex-1 overflow-y-auto" style={{ padding: "40px 24px" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <button type="button" onClick={() => setView("path")} style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", background: "none", border: "none", cursor: "pointer", marginBottom: "24px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
            ← Back to path
          </button>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--aqua)", fontWeight: 600, marginBottom: "6px" }}>
            {drill.type === "speaking" ? `Speaking · ${drill.durationSeconds}s` : "Quiz"}
          </p>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "24px" }}>{drill.title}</h1>
          {drill.type === "speaking" ? (
            <SpeakingLesson key={drill.id} drill={drill} onComplete={handleComplete} />
          ) : (
            <QuizLesson key={drill.id} drill={drill} onComplete={handleComplete} />
          )}
        </div>
      </div>
    );
  }

  // ── complete ──────────────────────────────────────────────────────────────
  if (view === "complete") {
    return (
      <LessonComplete
        score={lastScore}
        drill={drills[currentDrillIndex]}
        onBack={() => setView("path")}
        hasNext={currentDrillIndex < drills.length - 1}
        onNext={() => openLesson(currentDrillIndex + 1)}
      />
    );
  }

  return null;
}
