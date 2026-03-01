"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { format } from "date-fns";

const STORAGE_KEY = "cue_local_sessions";

interface LocalSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  overall_score: number | null;
}

function loadLocalSessions(): LocalSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(sessions: LocalSession[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

export default function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setSessions(loadLocalSessions());
  }, []);

  const handleNewSession = () => {
    setCreating(true);
    const session: LocalSession = {
      id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      ended_at: null,
      overall_score: null,
    };
    const next = [session, ...sessions];
    setSessions(next);
    saveLocalSessions(next);
    setCreating(false);
    router.push(`/app/sessions/${session.id}`);
  };

  const sessionIdFromPath = pathname?.startsWith("/app/sessions/")
    ? pathname.split("/")[3]
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      <button
        onClick={handleNewSession}
        disabled={creating}
        className="w-full rounded-lg bg-aqua px-3 py-2.5 text-sm font-medium text-gray-950 hover:bg-aqua-300 disabled:opacity-50 transition-colors"
      >
        {creating ? "Creating…" : "New session"}
      </button>

      {sessions.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">No sessions yet</p>
      ) : (
        <ul className="space-y-0.5">
          {sessions.map((s) => {
            const isActive = sessionIdFromPath === s.id;
            return (
              <li key={s.id}>
                <button
                  onClick={() => router.push(`/app/sessions/${s.id}`)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  }`}
                >
                  <span className="block truncate">
                    {s.started_at
                      ? format(new Date(s.started_at), "MMM d, h:mm a")
                      : "Session"}
                  </span>
                  {s.overall_score != null && (
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Score: {Math.round(s.overall_score)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
