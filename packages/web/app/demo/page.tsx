import Link from "next/link";

export default function DemoPage() {
  return (
    <main style={{ background: "var(--bg)", color: "var(--fg)", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      {/* Nav */}
      <nav className="absolute top-0 left-0 right-0 flex items-center justify-between" style={{ padding: "18px 32px" }}>
        <Link href="/" style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--aqua)", textDecoration: "none" }}>
          cue.
        </Link>
        <Link href="/app" className="btn-pill btn-primary" style={{ padding: "8px 22px", fontSize: "0.78rem" }}>
          Get started
        </Link>
      </nav>

      <div style={{ maxWidth: "620px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
        <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, textAlign: "center" }}>
          See it in action.
        </h1>

        {/* Video embed */}
        <div
          className="glow-pulse"
          style={{ width: "100%", borderRadius: "20px", overflow: "hidden", border: "1px solid rgba(45,255,192,0.12)", aspectRatio: "16/9" }}
        >
          <iframe
            src="https://www.youtube.com/embed/P8lcn59cOio?autoplay=1&rel=0"
            title="Cue demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>

        <Link href="/" className="btn-pill btn-ghost" style={{ padding: "10px 28px" }}>
          ← Back
        </Link>
      </div>
    </main>
  );
}
