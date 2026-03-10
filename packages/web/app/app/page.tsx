import Link from "next/link";

export default function AppHomePage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center fade-in-up" style={{ maxWidth: "360px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
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
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          <Link href="/app" className="btn-pill btn-primary" style={{ padding: "10px 24px" }}>
            New session
          </Link>
          <Link href="/" className="btn-pill btn-ghost" style={{ padding: "10px 24px" }}>
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}
