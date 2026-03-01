"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "../lib/supabase";

interface WordToken {
  word: string;
  start: number;   // seconds from session start
  end: number;
  isFiller: boolean;
}

interface Props {
  events: SessionEvent[];
  sessionStartedAt: string;
  /** Current playback time in seconds (controlled from parent) */
  currentTime?: number;
}

const FILLER_WORDS = new Set(["uh", "um", "like", "you know", "so", "basically", "literally"]);

/** Build a flat list of word tokens from audio_signal events. */
function buildTokens(events: SessionEvent[], sessionStart: Date): WordToken[] {
  const tokens: WordToken[] = [];
  const audioEvents = events
    .filter((e) => e.event_type === "audio_signal")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const ev of audioEvents) {
    const chunk = (ev.payload.transcript_chunk as string) ?? "";
    if (!chunk.trim()) continue;

    const evTimeSec =
      (new Date(ev.timestamp).getTime() - sessionStart.getTime()) / 1000;

    const words = chunk.trim().split(/\s+/);
    const chunkDuration = 5; // each audio_signal covers 5 seconds
    const wordDuration = chunkDuration / words.length;

    words.forEach((word, i) => {
      const start = evTimeSec - chunkDuration + i * wordDuration;
      tokens.push({
        word,
        start,
        end: start + wordDuration,
        isFiller: FILLER_WORDS.has(word.toLowerCase().replace(/[^a-z ]/g, "")),
      });
    });
  }
  return tokens;
}

/** Build a Set of seconds where attention was low. */
function buildLowAttentionSeconds(events: SessionEvent[], sessionStart: Date): Set<number> {
  const bad = new Set<number>();
  for (const ev of events) {
    if (ev.event_type !== "audience_signal") continue;
    const score = (ev.payload.attention_score as number) ?? 1;
    if (score < 0.6) {
      const sec = Math.floor(
        (new Date(ev.timestamp).getTime() - sessionStart.getTime()) / 1000
      );
      // Mark a 3-second window around this signal
      for (let i = -1; i <= 4; i++) bad.add(sec + i);
    }
  }
  return bad;
}

/** Build a Set of seconds where a Q&A question was active. */
function buildQASeconds(events: SessionEvent[], sessionStart: Date): Set<number> {
  const qa = new Set<number>();
  for (const ev of events) {
    if (ev.event_type !== "qa_event") continue;
    const sec = Math.floor(
      (new Date(ev.timestamp).getTime() - sessionStart.getTime()) / 1000
    );
    for (let i = -1; i <= 5; i++) qa.add(sec + i);
  }
  return qa;
}

export default function TranscriptPlayer({ events, sessionStartedAt, currentTime }: Props) {
  const sessionStart = new Date(sessionStartedAt);
  const tokens = buildTokens(events, sessionStart);
  const lowAttentionSeconds = buildLowAttentionSeconds(events, sessionStart);
  const qaSeconds = buildQASeconds(events, sessionStart);

  const activeRef = useRef<HTMLSpanElement | null>(null);

  // Scroll active word into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentTime]);

  if (!tokens.length) {
    return (
      <div className="text-sm text-gray-500 italic">No transcript available for this session.</div>
    );
  }

  return (
    <div className="font-mono text-sm leading-7 whitespace-pre-wrap break-words select-text text-gray-300">
      {tokens.map((token, i) => {
        const isActive =
          currentTime !== undefined &&
          currentTime >= token.start &&
          currentTime < token.end;

        const isLowAttention = lowAttentionSeconds.has(Math.floor(token.start));
        const isQA = qaSeconds.has(Math.floor(token.start));

        let bg = "";
        if (isQA) bg = "bg-aqua/20";
        else if (isLowAttention) bg = "bg-gray-600";

        let textClass = "";
        if (token.isFiller) textClass = "text-aqua font-semibold underline decoration-dotted";
        if (isActive) textClass += " ring-1 ring-aqua rounded";

        return (
          <span
            key={i}
            ref={isActive ? activeRef : undefined}
            className={`${bg} ${textClass} rounded px-0.5 transition-colors`}
            title={
              token.isFiller
                ? "Filler word"
                : isQA
                ? "Q&A moment"
                : isLowAttention
                ? "Low audience attention"
                : undefined
            }
          >
            {token.word}{" "}
          </span>
        );
      })}
    </div>
  );
}
