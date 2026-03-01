"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { format } from "date-fns";
import { getSessions, createSession, type Session } from "../../lib/api";

export default function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    getSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const handleNewSession = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const session = await createSession();
      setSessions((prev) => [session, ...prev]);
      router.push(`/app/sessions/${session.id}`);
    } catch (err) {
      let message = err instanceof Error ? err.message : "Could not create session";
      if (message === "Failed to fetch" || (err instanceof TypeError && err.message.includes("fetch"))) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        message = `Backend unreachable at ${apiUrl}. Is it running?`;
      }
      setCreateError(message);
      console.error("Create session failed:", err);
      // Still open prep view (upload + chat) so the user can use the UI; actions will show errors until backend is up
      const fallbackId = crypto.randomUUID();
      router.push(`/app/sessions/${fallbackId}`);
    } finally {
      setCreating(false);
    }
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

      {createError && (
        <p className="text-xs text-red-400 px-1 py-1" role="alert">
          {createError}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-500 py-2">Loading…</p>
      ) : sessions.length === 0 ? (
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
