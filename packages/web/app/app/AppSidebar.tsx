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
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      <button
        onClick={handleNewSession}
        disabled={creating}
        className="btn-pill btn-primary w-full"
        style={{ padding: "8px 16px", textAlign: "center", justifyContent: "center" }}
      >
        {creating ? "Creating…" : "New session"}
      </button>

      {createError && (
        <p style={{ fontSize: "0.75rem", color: "#f87171", padding: "0 4px" }} role="alert">
          {createError}
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.3)", padding: "8px 4px" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: "0.75rem", color: "rgba(240,245,243,0.3)", padding: "8px 4px" }}>No sessions yet</p>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {sessions.map((s) => {
            const isActive = sessionIdFromPath === s.id;
            return (
              <li key={s.id}>
                <button
                  onClick={() => router.push(`/app/sessions/${s.id}`)}
                  className="w-full text-left"
                  style={{
                    borderRadius: "12px",
                    padding: "10px 12px",
                    fontSize: "0.875rem",
                    transition: "background 0.15s, color 0.15s",
                    background: isActive ? "rgba(45,255,192,0.1)" : "transparent",
                    color: isActive ? "var(--fg)" : "rgba(240,245,243,0.5)",
                    borderLeft: isActive ? "2px solid var(--aqua)" : "2px solid transparent",
                  }}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.started_at
                      ? format(new Date(s.started_at), "MMM d, h:mm a")
                      : "Session"}
                  </span>
                  {s.overall_score != null && (
                    <span style={{ display: "block", fontSize: "0.7rem", color: "rgba(240,245,243,0.3)", marginTop: "2px" }}>
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
