"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const GlassesViewer = dynamic(() => import("../components/GlassesViewer"), { ssr: false });

const MARQUEE_TEXT = "cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0";

const ROWS = 8;

export default function Home() {
  const sectionRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("fade-in-up");
          }
        });
      },
      { threshold: 0.15 }
    );

    const targets = sectionRef.current?.querySelectorAll("[data-reveal]");
    targets?.forEach((el) => observer.observe(el));

    const modelObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setModelReady(true);
          modelObserver.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    if (spacerRef.current) modelObserver.observe(spacerRef.current);

    return () => {
      observer.disconnect();
      modelObserver.disconnect();
    };
  }, []);

  return (
    <main style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* ─── HERO ──────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center min-h-screen"
        style={{ paddingTop: "0" }}
      >
        {/* Background marquee */}
        <div
          className="absolute inset-0 flex flex-col justify-center gap-0 overflow-hidden select-none pointer-events-none"
          aria-hidden="true"
        >
          {Array.from({ length: ROWS }).map((_, i) => (
            <div
              key={i}
              className="marquee-track"
              style={{ opacity: 0.045 + (i % 2) * 0.015 }}
            >
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                style={{
                  fontSize: "clamp(2.5rem, 6vw, 5rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--fg)",
                  display: "inline-block",
                  paddingBottom: "0.1em",
                }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                aria-hidden="true"
                style={{
                  fontSize: "clamp(2.5rem, 6vw, 5rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--fg)",
                  display: "inline-block",
                  paddingBottom: "0.1em",
                }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
            </div>
          ))}
        </div>

        {/* Radial vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 65% at 50% 50%, transparent 20%, var(--bg) 75%)",
          }}
          aria-hidden="true"
        />

        {/* Nav */}
        <nav
          style={{ padding: "18px 32px" }}
          className="absolute top-0 left-0 right-0 flex items-center justify-between z-20"
        >
          <span
            style={{
              fontSize: "1.4rem",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "var(--aqua)",
            }}
          >
            cue.
          </span>
          <Link href="/demo" className="btn-pill btn-ghost" style={{ padding: "8px 22px", fontSize: "0.78rem" }}>
            Watch demo
          </Link>
        </nav>

        {/* Hero content */}
        <div
          className="relative z-10 flex flex-col items-center text-center gap-7 mx-auto"
          style={{ maxWidth: "900px", padding: "0 48px" }}
        >
          <p
            className="fade-in-up"
            style={{
              fontSize: "0.78rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--aqua)",
              fontWeight: 600,
            }}
          >
            Now in development!
          </p>

          <h1
            className="fade-in-up delay-1"
            style={{
              fontSize: "clamp(2.8rem, 7vw, 6rem)",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 0.95,
              color: "var(--fg)",
            }}
          >
            Speak better.
            <br />
            <span style={{ color: "var(--aqua)" }}>Right now.</span>
          </h1>

          <p
            className="fade-in-up delay-2"
            style={{
              maxWidth: "460px",
              fontSize: "clamp(1rem, 2.2vw, 1.15rem)",
              lineHeight: 1.7,
              color: "rgba(240,245,243,0.5)",
              fontWeight: 400,
            }}
          >
            Real-time coaching through your smart glasses.
            <br />
            Nudges when you need them, silence when you don&apos;t.
          </p>

          <div className="fade-in-up delay-3 flex items-center gap-4 mt-2 flex-wrap justify-center">
            <Link href="/app" className="btn-pill btn-primary">
              Get started
            </Link>
            <Link href="/demo" className="btn-pill btn-ghost">
              Watch demo
            </Link>
          </div>
        </div>

        {/* Scroll hint */}
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 fade-in-up delay-5 z-10 flex flex-col items-center"
          style={{ opacity: 0.3 }}
        >
          <div
            style={{
              width: "1px",
              height: "52px",
              background: "linear-gradient(to bottom, var(--aqua), transparent)",
            }}
          />
        </div>
      </section>

      {/* ─── 3D MODEL ─────────────────────────────────────── */}
      <section
        id="model"
        className="relative flex flex-col items-center justify-center"
        style={{ padding: "220px 48px 0", zIndex: 10, position: "relative" }}
      >
        {/* Soft glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(45,255,192,0.05) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        {/* Spacer so the section has layout height */}
        <div ref={spacerRef} style={{ width: "100%", height: "500px", pointerEvents: "none" }} />

        {/* Canvas extends above and below the section */}
        <div style={{
          position: "absolute",
          top: "-200px",
          left: 0,
          right: 0,
          height: "calc(100% + 400px)",
          zIndex: 9999,
          pointerEvents: "auto",
        }}>
          <GlassesViewer ready={modelReady} />
        </div>
      </section>

      {/* ─── ABOUT ────────────────────────────────────────── */}
      <section
        id="about"
        ref={sectionRef}
        className="relative flex flex-col mx-auto"
        style={{ maxWidth: "900px", padding: "0px 48px 96px", gap: "80px", position: "relative", zIndex: 1 }}
      >
        {/* Problem / Solution */}
        <div className="flex flex-col" style={{ gap: "28px" }} data-reveal>
          <div className="divider" />
          <h2
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
            }}
          >
            The gap between
            <br />
            <span style={{ color: "var(--aqua)" }}>feedback and the moment.</span>
          </h2>
          <p
            style={{
              maxWidth: "520px",
              fontSize: "1.05rem",
              lineHeight: 1.8,
              color: "rgba(240,245,243,0.5)",
            }}
          >
            The most important presentations are the most difficult. Mirrors and
            recordings might help before and after the fact, but not when your
            voice tightens and the room goes cold. Cue sits in your ear and sees
            the room alongside you, nudging your pace and re-engaging a drifting
            audience — in the moment it matters.
          </p>
        </div>

        {/* Feature grid */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "16px",
          }}
          data-reveal
        >
          {[
            {
              icon: "◉",
              title: "Always-on awareness",
              body: "Passive mic + camera through your Ray-Bans. No setup, no interruption.",
            },
            {
              icon: "◎",
              title: "In-ear nudges",
              body: "Whispered cues — adjust pacing, hit your talking point, re-engage the room.",
            },
            {
              icon: "◈",
              title: "Post-talk breakdown",
              body: "Filler word counts, pause patterns, and engagement heatmaps after every session.",
            },
          ].map((f) => (
            <div key={f.title} className="feature-card" style={{ padding: "36px" }}>
              <div
                style={{
                  fontSize: "1.6rem",
                  marginBottom: "20px",
                  color: "var(--aqua)",
                }}
              >
                {f.icon}
              </div>
              <h3
                style={{
                  fontWeight: 700,
                  fontSize: "1rem",
                  marginBottom: "12px",
                  letterSpacing: "-0.01em",
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: "0.9rem",
                  lineHeight: 1.7,
                  color: "rgba(240,245,243,0.48)",
                }}
              >
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center text-center overflow-hidden"
        style={{ padding: "120px 48px" }}
      >
        {/* Background marquee */}
        <div
          className="absolute inset-0 flex flex-col justify-center gap-0 overflow-hidden"
          aria-hidden="true"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="marquee-track" style={{ opacity: 0.03 }}>
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                style={{
                  fontSize: "clamp(3rem, 7vw, 6rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--aqua)",
                  display: "inline-block",
                }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                aria-hidden="true"
                style={{
                  fontSize: "clamp(3rem, 7vw, 6rem)",
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--aqua)",
                  display: "inline-block",
                }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
            </div>
          ))}
        </div>

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, var(--bg) 80%)",
          }}
          aria-hidden="true"
        />

        <div
          className="relative z-10 flex flex-col items-center"
          style={{ maxWidth: "640px", gap: "28px" }}
        >
          <h2
            style={{
              fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1,
            }}
          >
            Get started.
          </h2>
          <p
            style={{
              color: "rgba(240,245,243,0.42)",
              fontSize: "1.05rem",
              lineHeight: 1.7,
            }}
          >
            Upload your context, ask your questions, and start your first session.
          </p>
          <div
            className="flex items-center flex-wrap justify-center"
            style={{ gap: "16px", marginTop: "8px" }}
          >
            <Link href="/app" className="btn-pill btn-primary">
              Get started →
            </Link>
            <Link href="/demo" className="btn-pill btn-ghost">
              Watch demo
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────── */}
      <footer
        className="flex items-center justify-between border-t"
        style={{
          borderColor: "rgba(45,255,192,0.08)",
          padding: "28px 48px",
        }}
      >
        <span
          style={{
            fontSize: "1.1rem",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "var(--aqua)",
          }}
        >
          cue.
        </span>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,245,243,0.22)" }}>
          © {new Date().getFullYear()} Cue. All rights reserved.
        </p>
      </footer>
    </main>
  );
}
