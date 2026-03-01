"use client";

import { formatDistanceToNow, format } from "date-fns";
import type { SessionEvent } from "../lib/supabase";

interface Props {
  events: SessionEvent[];
  sessionStartedAt: string;
  /** Called when user clicks a nudge/QA marker — scrubs the transcript player */
  onSeek?: (timestamp: string) => void;
}

const NUDGE_COLORS: Record<string, string> = {
  filler_word_rate: "bg-yellow-100 border-yellow-400 text-yellow-800",
  attention_score: "bg-red-100 border-red-400 text-red-800",
  words_per_minute: "bg-blue-100 border-blue-400 text-blue-800",
  volume_rms: "bg-purple-100 border-purple-400 text-purple-800",
  pitch_variance: "bg-orange-100 border-orange-400 text-orange-800",
};

const QA_COLOR = "bg-indigo-100 border-indigo-400 text-indigo-800";

export default function NudgeTimeline({ events, sessionStartedAt, onSeek }: Props) {
  const nudges = events.filter((e) => e.event_type === "nudge");
  const qaEvents = events.filter((e) => e.event_type === "qa_event");

  const timeline: Array<{ event: SessionEvent; label: string; color: string }> = [
    ...nudges.map((e) => ({
      event: e,
      label: (e.payload.text as string) ?? "Nudge",
      color: NUDGE_COLORS[(e.payload.trigger_signal as string) ?? ""] ?? "bg-gray-100 border-gray-400 text-gray-800",
    })),
    ...qaEvents.map((e) => ({
      event: e,
      label: e.payload.whispered
        ? `Q&A whisper: "${e.payload.question_text}"`
        : `Q&A handled: "${e.payload.question_text}"`,
      color: QA_COLOR,
    })),
  ].sort((a, b) => new Date(a.event.timestamp).getTime() - new Date(b.event.timestamp).getTime());

  if (!timeline.length) {
    return <p className="text-sm text-gray-400">No nudges or Q&A events in this session.</p>;
  }

  const sessionStart = new Date(sessionStartedAt).getTime();

  return (
    <div className="relative">
      {/* Vertical stem */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />

      <ul className="space-y-4 pl-8">
        {timeline.map(({ event, label, color }) => {
          const offsetMs = new Date(event.timestamp).getTime() - sessionStart;
          const offsetSec = Math.max(0, Math.floor(offsetMs / 1000));
          const mm = String(Math.floor(offsetSec / 60)).padStart(2, "0");
          const ss = String(offsetSec % 60).padStart(2, "0");

          return (
            <li
              key={event.id}
              className="relative flex items-start gap-3 cursor-pointer group"
              onClick={() => onSeek?.(event.timestamp)}
            >
              {/* Dot */}
              <span
                className={`absolute -left-5 mt-1 w-3 h-3 rounded-full border-2 ${
                  event.event_type === "qa_event"
                    ? "border-indigo-500 bg-indigo-200"
                    : "border-gray-400 bg-white"
                }`}
              />

              <div className={`flex-1 px-3 py-2 rounded border text-xs ${color} group-hover:opacity-80 transition-opacity`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{`${mm}:${ss}`}</span>
                  {event.event_type === "nudge" && (
                    <span className="uppercase tracking-wide text-[10px] opacity-60">
                      {(event.payload.trigger_signal as string)?.replace("_", " ")}
                    </span>
                  )}
                  {event.event_type === "qa_event" && (
                    <span className="uppercase tracking-wide text-[10px] opacity-60">
                      {event.payload.whispered ? "whispered" : "handled"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 leading-snug">{label}</p>
                {event.event_type === "nudge" && event.payload.trigger_value != null && (
                  <p className="mt-0.5 opacity-60">
                    value: {String(event.payload.trigger_value)}
                  </p>
                )}
                {event.event_type === "qa_event" && event.payload.answer_text && (
                  <p className="mt-1 italic opacity-70 line-clamp-2">
                    Answer: {event.payload.answer_text as string}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
