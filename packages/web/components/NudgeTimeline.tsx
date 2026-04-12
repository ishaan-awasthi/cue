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
  filler_word_rate: "bg-aqua/20 border-aqua/50 text-aqua",
  attention_score: "bg-gray-600 border-gray-500 text-gray-200",
  words_per_minute: "bg-aqua/20 border-aqua/50 text-aqua",
  volume_rms: "bg-gray-700 border-gray-500 text-gray-200",
  pitch_variance: "bg-gray-700 border-gray-500 text-gray-200",
};

const QA_COLOR = "bg-aqua/20 border-aqua/50 text-aqua";

export default function NudgeTimeline({ events, sessionStartedAt, onSeek }: Props) {
  const nudges = events.filter((e) => e.event_type === "nudge");
  const qaEvents = events.filter((e) => e.event_type === "qa_event");

  const timeline: Array<{ event: SessionEvent; label: string; color: string }> = [
    ...nudges.map((e) => ({
      event: e,
      label: (e.payload.text as string) ?? "Nudge",
      color: NUDGE_COLORS[(e.payload.trigger_signal as string) ?? ""] ?? "bg-gray-700 border-gray-500 text-gray-200",
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
    return <p className="text-sm text-gray-500">No nudges or Q&A events in this session.</p>;
  }

  const sessionStart = new Date(sessionStartedAt).getTime();

  return (
    <div className="relative">
      {/* Vertical stem */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-600" />

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
                    ? "border-aqua bg-aqua/30"
                    : "border-gray-500 bg-gray-700"
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
                {event.event_type === "qa_event" && typeof event.payload.answer_text === "string" && (
                  <p className="mt-1 italic opacity-70 line-clamp-2">
                    Answer: {event.payload.answer_text}
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
