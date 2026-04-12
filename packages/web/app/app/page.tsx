"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSession } from "../../lib/api";

export default function AppHomePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNewSession = async () => {
    setError(null);
    setCreating(true);
    try {
      const session = await createSession();
      router.push(`/app/sessions/${session.id}`);
    } catch (err) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const msg = err instanceof Error ? err.message : "Could not create session";
      setError(msg.includes("Failed to fetch") ? `Backend unreachable at ${apiUrl}` : msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        className="text-center fade-in-up"
        style={{ maxWidth: "360px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}
      >
        <h2
          style={{
            fontSize: "clamp(1.4rem, 3vw, 1.8rem)",
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 0.95,
            color: "var(--fg)",
          }}
        >
          No session selected
        </h2>
        <p style={{ fontSize: "0.9rem", lineHeight: 1.7, color: "rgba(240,245,243,0.5)" }}>
          Choose a session from the sidebar, or start a new one to upload context
          before you present.
        </p>
        {error && <p style={{ fontSize: "0.8rem", color: "#f87171" }}>{error}</p>}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={handleNewSession}
            className="btn-pill btn-primary"
            style={{ padding: "10px 24px" }}
            disabled={creating}
          >
            {creating ? "Creating..." : "New session"}
          </button>
          <Link href="/" className="btn-pill btn-ghost" style={{ padding: "10px 24px" }}>
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}
