"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { listSessions, getCurrentUserId } from "../../../lib/supabase";
import { getSessionReport, analyzePracticeDrill, type PracticeAnalyzeResult } from "../../../lib/api";
import type { Session } from "../../../lib/supabase";

// ---------------------------------------------------------------------------
// Lesson definitions
// ---------------------------------------------------------------------------

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

const DEMO_DRILLS: Drill[] = [
  {
    type: "speaking",
    id: "d-1",
    title: "The 60-second hook",
    description: "Open strong without notes",
    prompt:
      "Introduce yourself and your biggest professional achievement — no notes, just talk. Aim for a strong opening sentence.",
    durationSeconds: 60,
    tip: "Start with a bold claim or surprising number. Avoid opening with 'So,' or 'Okay, um...'",
  },
  {
    type: "quiz",
    id: "d-2",
    title: "Filler word awareness",
    description: "Know which words to cut",
    question:
      "Which is the most effective replacement for a filler word like 'um'?",
    options: [
      "Say 'basically' instead",
      "Pause silently for 1–2 seconds",
      "Speed up to hide the gap",
      "Use 'right?' to engage the audience",
    ],
    correctIndex: 1,
    explanation:
      "A deliberate pause feels more confident than any filler. Silence gives the audience time to absorb your point.",
  },
  {
    type: "speaking",
    id: "d-3",
    title: "Vary your pace",
    description: "Speed up and slow down on purpose",
    prompt:
      "Tell a short story about a challenge you overcame. Deliberately slow down on the most important moment.",
    durationSeconds: 90,
    tip: "Speed up during background context, slow down and lower pitch on the key insight.",
  },
  {
    type: "quiz",
    id: "d-4",
    title: "Ideal speaking pace",
    description: "Find the right WPM range",
    question:
      "What words-per-minute range is generally considered clear and engaging for presentations?",
    options: ["60–90 WPM", "110–160 WPM", "170–200 WPM", "220+ WPM"],
    correctIndex: 1,
    explanation:
      "110–160 WPM is the sweet spot — fast enough to sound energised, slow enough for complex ideas to land.",
  },
  {
    type: "speaking",
    id: "d-5",
    title: "Handle a tough question",
    description: "Buy time, stay calm",
    prompt:
      "Someone just asked: 'Why should we trust your numbers?' Answer calmly and confidently without fillers.",
    durationSeconds: 45,
    tip: "Bridge with 'That's a great question — here's what the data shows...' then give one clear point.",
  },
];

function buildDrillsFromReport(areas: string[], drills: string[]): Drill[] {
  const result: Drill[] = [];
  areas.forEach((area, i) => {
    result.push({
      type: "speaking",
      id: `area-${i}`,
      title: area,
      description: "Targeted speaking drill",
      prompt: `Speak for 60 seconds on a topic you know well, focusing specifically on: ${area}. Keep going even if you stumble.`,
      durationSeconds: 60,
      tip: area,
    } as SpeakingDrill);
  });
  drills.forEach((drill, i) => {
    result.push({
      type: "speaking",
      id: `drill-${i}`,
      title: drill,
      description: "From your session report",
      prompt: `Practice this drill: ${drill}. Speak naturally for 45 seconds.`,
      durationSeconds: 45,
      tip: drill,
    } as SpeakingDrill);
  });
  // Always include at least one quiz for variety
  result.push(DEMO_DRILLS[1], DEMO_DRILLS[3]);
  return result;
}

// ---------------------------------------------------------------------------
// Speech recorder hook
// ---------------------------------------------------------------------------

interface RecorderState {
  status: "idle" | "recording" | "done" | "error";
  transcript: string;
  durationSeconds: number;
  wordCount: number;
  fillerCount: number;
  errorMsg: string;
}

// Single-word fillers — checked word-by-word after stripping punctuation
const FILLER_WORD_SET = new Set([
  "uh", "um", "hmm", "er", "erm", "like", "so", "basically", "literally", "actually",
]);
// Bigram fillers — checked against the raw transcript before splitting
const FILLER_BIGRAMS = ["you know", "i mean", "kind of", "sort of", "you see"];

function countFillers(transcript: string): { count: number; found: string[] } {
  let text = transcript.toLowerCase();
  const found: string[] = [];

  // Check bigrams first (replace so they don't also match single words)
  for (const bigram of FILLER_BIGRAMS) {
    const re = new RegExp(bigram.replace(" ", "\\s+"), "g");
    const matches = text.match(re);
    if (matches) {
      found.push(...matches.map(() => bigram));
      text = text.replace(re, " _ ");
    }
  }

  // Check single words
  const words = text.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, "");
    if (FILLER_WORD_SET.has(clean)) {
      found.push(clean);
    }
  }

  return { count: found.length, found };
}

function useSpeechRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: "idle",
    transcript: "",
    durationSeconds: 0,
    wordCount: 0,
    fillerCount: 0,
    errorMsg: "",
  });
  const [elapsed, setElapsed] = useState(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<string>("");

  const start = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;

    if (!SR) {
      setState((s) => ({
        ...s,
        status: "error",
        errorMsg: "Speech recognition is not supported in this browser. Try Chrome or Edge.",
      }));
      return;
    }

    transcriptRef.current = "";
    startTimeRef.current = Date.now();
    setElapsed(0);

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    let finalTranscript = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      transcriptRef.current = finalTranscript + interim;
      setState((s) => ({ ...s, transcript: transcriptRef.current }));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setState((s) => ({
        ...s,
        status: "error",
        errorMsg: `Mic error: ${e.error}`,
      }));
    };

    recognition.start();

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);

    setState((s) => ({ ...s, status: "recording", transcript: "", errorMsg: "" }));
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    const durationSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const transcript = transcriptRef.current.trim();
    const words = transcript.split(/\s+/).filter(Boolean);
    const { count: fillerCount } = countFillers(transcript);
    setState({
      status: "done",
      transcript,
      durationSeconds,
      wordCount: words.length,
      fillerCount,
      errorMsg: "",
    });
    setElapsed(durationSeconds);
  }, []);

  const reset = useCallback(() => {
    recognitionRef.current?.abort();
    if (timerRef.current) clearInterval(timerRef.current);
    transcriptRef.current = "";
    setElapsed(0);
    setState({
      status: "idle",
      transcript: "",
      durationSeconds: 0,
      wordCount: 0,
      fillerCount: 0,
      errorMsg: "",
    });
  }, []);

  return { state, elapsed, start, stop, reset };
}

// ---------------------------------------------------------------------------
// Score ring
// ---------------------------------------------------------------------------

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const colorClass =
    score >= 80 ? "text-aqua" : score >= 60 ? "text-gray-300" : "text-gray-500";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
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
          strokeDasharray={`${score} ${100 - score}`}
          strokeLinecap="round"
          className={`${colorClass} transition-all duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold text-white">{Math.round(score)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speaking lesson
// ---------------------------------------------------------------------------

function SpeakingLesson({
  drill,
  onComplete,
  onBack,
}: {
  drill: SpeakingDrill;
  onComplete: (score: number) => void;
  onBack: () => void;
}) {
  const { state, elapsed, start, stop, reset } = useSpeechRecorder();
  const [result, setResult] = useState<PracticeAnalyzeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-stop when drill duration is reached
  useEffect(() => {
    if (state.status === "recording") {
      autoStopRef.current = setTimeout(stop, drill.durationSeconds * 1000);
    }
    return () => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
  }, [state.status, drill.durationSeconds, stop]);

  // Analyze once recording finishes
  useEffect(() => {
    if (state.status !== "done") return;
    setAnalyzing(true);
    setAnalyzeError(null);
    const wpm =
      state.durationSeconds > 0
        ? (state.wordCount / state.durationSeconds) * 60
        : 0;
    analyzePracticeDrill({
      transcript: state.transcript,
      words_per_minute: Math.round(wpm),
      filler_word_count: state.fillerCount,
      duration_seconds: state.durationSeconds,
    })
      .then(setResult)
      .catch(() => {
        const localScore = Math.max(
          0,
          Math.min(100, 80 - state.fillerCount * 5 + (wpm >= 110 && wpm <= 160 ? 10 : 0))
        );
        setResult({
          score: localScore,
          nudges: [],
          filler_words_found: [],
          wpm: Math.round(wpm),
        });
        setAnalyzeError("Backend unreachable — showing estimated score.");
      })
      .finally(() => setAnalyzing(false));
  }, [state.status, state.transcript, state.wordCount, state.fillerCount, state.durationSeconds]);

  const remaining = Math.max(0, drill.durationSeconds - elapsed);
  const progressPct = Math.min(100, (elapsed / drill.durationSeconds) * 100);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <button
          type="button"
          onClick={() => { reset(); onBack(); }}
          className="text-sm text-gray-500 hover:text-aqua inline-flex items-center gap-1 transition-colors"
        >
          ← Back to path
        </button>

        <div>
          <p className="text-xs font-medium text-aqua uppercase tracking-wide mb-1">
            Speaking drill
          </p>
          <h1 className="text-2xl font-bold text-white mb-1">{drill.title}</h1>
          <p className="text-sm text-gray-400">{drill.description}</p>
        </div>

        {/* Tip */}
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 px-4 py-3">
          <p className="text-xs text-aqua font-medium mb-1">Coaching tip</p>
          <p className="text-sm text-gray-300 leading-relaxed">{drill.tip}</p>
        </div>

        {/* Prompt */}
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Your prompt</p>
          <p className="text-base text-gray-100 leading-relaxed">{drill.prompt}</p>
          <p className="text-xs text-gray-500 mt-3">
            Target: {drill.durationSeconds}s · Speak clearly into your mic
          </p>
        </div>

        {/* Idle */}
        {state.status === "idle" && (
          <button
            onClick={start}
            className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
          >
            Start recording
          </button>
        )}

        {/* Recording */}
        {state.status === "recording" && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Recording…
                </span>
                <span>{remaining}s remaining</span>
              </div>
              <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-aqua transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {state.transcript && (
              <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 max-h-36 overflow-y-auto">
                <p className="text-xs text-gray-500 mb-1">Live transcript</p>
                <p className="text-sm text-gray-300 leading-relaxed">{state.transcript}</p>
              </div>
            )}

            <button
              onClick={stop}
              className="w-full rounded-xl border border-gray-600 px-4 py-3 text-sm font-medium text-gray-200 hover:border-aqua hover:text-aqua transition-colors"
            >
              Stop early
            </button>
          </div>
        )}

        {/* Error */}
        {state.status === "error" && (
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
            <p className="text-sm font-medium text-gray-200 mb-1">
              Could not access microphone
            </p>
            <p className="text-sm text-gray-400">{state.errorMsg}</p>
            <button
              onClick={reset}
              className="mt-3 text-xs text-aqua hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {state.status === "done" && (
          <div className="space-y-4">
            {analyzing && (
              <div className="flex items-center gap-3 text-sm text-gray-400 py-2">
                <div className="w-5 h-5 border-2 border-aqua border-t-transparent rounded-full animate-spin shrink-0" />
                Analysing your speech…
              </div>
            )}

            {analyzeError && (
              <p className="text-xs text-gray-500">{analyzeError}</p>
            )}

            {result && !analyzing && (
              <>
                {/* Score card */}
                <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5 flex items-center gap-5">
                  <ScoreRing score={result.score} />
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-gray-300">Drill score</p>
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span>
                        WPM:{" "}
                        <span className="text-gray-200 font-semibold">
                          {result.wpm || "—"}
                        </span>
                      </span>
                      <span>
                        Fillers:{" "}
                        <span className="text-gray-200 font-semibold">
                          {state.fillerCount}
                        </span>
                      </span>
                      <span>
                        Duration:{" "}
                        <span className="text-gray-200 font-semibold">
                          {state.durationSeconds}s
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Nudges */}
                {result.nudges.length > 0 && (
                  <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                      Coaching feedback
                    </p>
                    <ul className="space-y-2">
                      {result.nudges.map((n, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-300">
                          <span className="text-aqua shrink-0 mt-0.5">•</span>
                          {n.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.nudges.length === 0 && (
                  <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
                    <p className="text-sm text-green-300 font-medium">
                      Clean delivery — no flags raised.
                    </p>
                  </div>
                )}

                {/* Filler words */}
                {result.filler_words_found.length > 0 && (
                  <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                      Filler words detected
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.filler_words_found.map((w, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-aqua/10 border border-aqua/30 px-2.5 py-0.5 text-xs text-aqua font-medium"
                        >
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transcript */}
                <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                    Your transcript
                  </p>
                  <p className="text-sm text-gray-300 leading-relaxed font-mono">
                    {state.transcript || <span className="italic text-gray-600">No speech detected.</span>}
                  </p>
                </div>

                <button
                  onClick={() => onComplete(result.score)}
                  className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
                >
                  Complete lesson
                </button>

                <button
                  onClick={reset}
                  className="w-full rounded-xl border border-gray-600 px-4 py-3 text-sm font-medium text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz lesson
// ---------------------------------------------------------------------------

function QuizLesson({
  drill,
  onComplete,
  onBack,
}: {
  drill: QuizDrill;
  onComplete: (score: number) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;
  const correct = selected === drill.correctIndex;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-aqua inline-flex items-center gap-1 transition-colors"
        >
          ← Back to path
        </button>

        <div>
          <p className="text-xs font-medium text-aqua uppercase tracking-wide mb-1">
            Knowledge check
          </p>
          <h1 className="text-2xl font-bold text-white mb-1">{drill.title}</h1>
          <p className="text-sm text-gray-400">{drill.description}</p>
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
          <p className="text-base text-gray-100 leading-relaxed font-medium">
            {drill.question}
          </p>
        </div>

        <ul className="space-y-2">
          {drill.options.map((opt, i) => {
            let cls =
              "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600";
            if (answered) {
              if (i === drill.correctIndex)
                cls = "border-green-500/60 bg-green-500/10 text-green-300";
              else if (i === selected)
                cls = "border-red-500/60 bg-red-500/10 text-red-300";
              else cls = "border-gray-800 bg-gray-900/30 text-gray-500";
            } else if (selected === i) {
              cls = "border-aqua bg-aqua/10 text-white";
            }
            return (
              <li key={i}>
                <button
                  onClick={() => !answered && setSelected(i)}
                  disabled={answered}
                  className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm transition-colors ${cls}`}
                >
                  {opt}
                </button>
              </li>
            );
          })}
        </ul>

        {answered && (
          <div
            className={`rounded-xl border p-4 ${
              correct
                ? "border-green-500/30 bg-green-500/10"
                : "border-gray-700 bg-gray-900/50"
            }`}
          >
            <p
              className={`text-sm font-medium mb-1 ${
                correct ? "text-green-300" : "text-gray-300"
              }`}
            >
              {correct
                ? "Correct!"
                : `The right answer is: "${drill.options[drill.correctIndex]}"`}
            </p>
            <p className="text-sm text-gray-400 leading-relaxed">
              {drill.explanation}
            </p>
          </div>
        )}

        {answered && (
          <button
            onClick={() => onComplete(correct ? 100 : 60)}
            className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson complete screen
// ---------------------------------------------------------------------------

function LessonComplete({
  drill,
  score,
  hasNext,
  onNext,
  onPath,
}: {
  drill: Drill;
  score: number;
  hasNext: boolean;
  onNext: () => void;
  onPath: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-6">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20 text-4xl text-green-400">
          ✓
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Lesson complete!</h2>
          <p className="text-gray-400">{drill.title}</p>
        </div>
        {drill.type === "speaking" && (
          <div className="flex justify-center">
            <ScoreRing score={score} size={80} />
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onPath}
            className="rounded-xl border border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Back to path
          </button>
          {hasNext && (
            <button
              onClick={onNext}
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type View = "pick-session" | "path" | "lesson" | "complete";

export default function PracticePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [drills, setDrills] = useState<Drill[]>(DEMO_DRILLS);
  const [completedScores, setCompletedScores] = useState<Record<string, number>>({});
  const [currentDrillIndex, setCurrentDrillIndex] = useState(0);
  const [lastScore, setLastScore] = useState(0);
  const [view, setView] = useState<View>("pick-session");

  useEffect(() => {
    listSessions(getCurrentUserId())
      .then((data) => setSessions(data ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }, []);

  const loadReport = useCallback((sessionId: string) => {
    setReportLoading(true);
    getSessionReport(sessionId)
      .then((r) => {
        const built = buildDrillsFromReport(
          r.report.areas_to_improve ?? [],
          r.report.suggested_drills ?? []
        );
        setDrills(built.length >= 2 ? built : DEMO_DRILLS);
      })
      .catch(() => setDrills(DEMO_DRILLS))
      .finally(() => setReportLoading(false));
  }, []);

  const completedCount = Object.keys(completedScores).length;
  const totalDrills = drills.length;
  const progressPct = totalDrills ? (completedCount / totalDrills) * 100 : 0;

  const handleComplete = (score: number) => {
    const drill = drills[currentDrillIndex];
    setCompletedScores((prev) => ({ ...prev, [drill.id]: score }));
    setLastScore(score);
    setView("complete");
  };

  // ---- pick-session ----
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
          <h1 className="text-2xl font-bold text-white mb-1">Practice path</h1>
          <p className="text-sm text-gray-500 mb-8">
            Pick a session to unlock drills tailored to your report, or use the
            default path.
          </p>

          <section className="mb-6 space-y-2">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
              Select a session
            </h2>

            <button
              onClick={() => {
                setSelectedSessionId(null);
                setDrills(DEMO_DRILLS);
                setCompletedScores({});
              }}
              className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm transition-colors ${
                selectedSessionId === null
                  ? "border-aqua bg-aqua/10 text-white"
                  : "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600"
              }`}
            >
              Default practice path
            </button>

            {loadingSessions ? (
              <p className="text-sm text-gray-500 py-2">Loading sessions…</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedSessionId(s.id);
                    setCompletedScores({});
                    loadReport(s.id);
                  }}
                  className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
                    selectedSessionId === s.id
                      ? "border-aqua bg-aqua/10 text-white"
                      : "border-gray-700 bg-gray-900/50 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  <span className="block text-sm font-medium">
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
              ))
            )}
          </section>

          {reportLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-aqua border-t-transparent rounded-full animate-spin" />
              Building your path…
            </div>
          ) : (
            <button
              onClick={() => {
                setCurrentDrillIndex(0);
                setView("path");
              }}
              className="w-full rounded-xl bg-aqua px-4 py-4 text-base font-semibold text-gray-950 hover:bg-aqua-300 transition-colors"
            >
              Start practice
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- path ----
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

          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Your progress</span>
              <span>
                {completedCount} / {totalDrills} lessons
              </span>
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
            {drills.map((drill, i) => {
              const done = drill.id in completedScores;
              const drillScore = completedScores[drill.id];

              return (
                <li key={drill.id}>
                  <button
                    onClick={() => {
                      setCurrentDrillIndex(i);
                      setView("lesson");
                    }}
                    className={`w-full flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all ${
                      done
                        ? "border-green-500/50 bg-green-500/10 text-green-300"
                        : "border-aqua/50 bg-gray-900/50 text-white hover:border-aqua hover:bg-aqua/5"
                    }`}
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                        done
                          ? "bg-green-500/20 text-green-300"
                          : "bg-aqua/15 text-aqua"
                      }`}
                    >
                      {done ? "✓" : drill.type === "speaking" ? "🎙" : "?"}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{drill.title}</p>
                      <p
                        className={`text-xs mt-0.5 flex items-center gap-2 ${
                          done ? "text-green-400/70" : "text-gray-400"
                        }`}
                      >
                        <span>
                          {drill.type === "speaking" ? "Speaking" : "Quiz"}
                        </span>
                        {drill.type === "speaking" && (
                          <span>· {(drill as SpeakingDrill).durationSeconds}s</span>
                        )}
                        <span>· {drill.description}</span>
                      </p>
                    </div>

                    {done && drillScore != null && drill.type === "speaking" && (
                      <span className="text-sm font-semibold text-green-300 shrink-0">
                        {Math.round(drillScore)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {completedCount === totalDrills && totalDrills > 0 && (
            <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
              <p className="text-green-300 font-semibold text-lg">
                Path complete!
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Avg score:{" "}
                {Math.round(
                  Object.values(completedScores).reduce((a, b) => a + b, 0) /
                    Object.values(completedScores).length
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- lesson ----
  if (view === "lesson") {
    const drill = drills[currentDrillIndex];
    if (!drill) return null;

    if (drill.type === "speaking") {
      return (
        <SpeakingLesson
          drill={drill as SpeakingDrill}
          onComplete={handleComplete}
          onBack={() => setView("path")}
        />
      );
    }

    return (
      <QuizLesson
        drill={drill as QuizDrill}
        onComplete={handleComplete}
        onBack={() => setView("path")}
      />
    );
  }

  // ---- complete ----
  if (view === "complete") {
    const drill = drills[currentDrillIndex];
    if (!drill) return null;
    return (
      <LessonComplete
        drill={drill}
        score={lastScore}
        hasNext={currentDrillIndex < drills.length - 1}
        onNext={() => {
          setCurrentDrillIndex((i) => i + 1);
          setView("lesson");
        }}
        onPath={() => setView("path")}
      />
    );
  }

  return null;
}
