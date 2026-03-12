"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const GlassesViewer = dynamic(() => import("../components/GlassesViewer"), { ssr: false });

const MARQUEE_TEXT = "cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0cue.\u00a0\u00a0\u00a0\u00a0";

export default function Home() {
  const sectionRef = useRef<HTMLElement>(null);
  const [heroTextReady, setHeroTextReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHeroTextReady(true), 1750);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("fade-in-up");
        });
      },
      { threshold: 0.15 }
    );
    const targets = sectionRef.current?.querySelectorAll("[data-reveal]");
    targets?.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <main style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* ─── HERO ──────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center"
        style={{ minHeight: isMobile ? "auto" : "calc(100vh - 160px)" }}
      >
        {/* Aqua glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 1,
            background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(45,255,192,0.05) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        {isMobile ? (
          /* ── Mobile hero: stacked layout with small glasses ── */
          <>
            <div
              className="relative z-10 flex items-center justify-between w-full"
              style={{ padding: "16px 20px" }}
            >
              <span style={{ fontSize: "1.4rem", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--aqua)" }}>
                cue.
              </span>
              <Link href="/demo" className="btn-pill btn-ghost" style={{ padding: "6px 16px", fontSize: "0.78rem" }}>
                Watch demo
              </Link>
            </div>
            <div style={{ width: "100%", height: "220px", position: "relative", zIndex: 10 }}>
              <GlassesViewer ready={true} />
            </div>
          </>
        ) : (
          /* ── Desktop hero: glasses fill viewport with corner text ── */
          <>
            <div className="absolute left-0 right-0" style={{ top: "80px", bottom: "-120px", zIndex: 10 }}>
              <GlassesViewer ready={true} />
            </div>

            {heroTextReady && (
              <div
                className="absolute top-0 left-0 right-0 flex items-center justify-between pointer-events-auto"
                style={{ padding: "28px 32px", zIndex: 3 }}
              >
                <span
                  className="hero-fade"
                  style={{ animationDelay: "0ms", fontSize: "1.4rem", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--aqua)" }}
                >
                  cue.
                </span>
                <Link
                  href="/demo"
                  className="hero-fade btn-pill btn-ghost"
                  style={{ animationDelay: "140ms", padding: "8px 22px", fontSize: "0.78rem" }}
                >
                  Watch demo
                </Link>
              </div>
            )}
          </>
        )}
      </section>

      {/* ─── ABOUT ────────────────────────────────────────── */}
      <section
        id="about"
        ref={sectionRef}
        className="relative flex flex-col mx-auto"
        style={{ maxWidth: "900px", padding: isMobile ? "0 20px 64px" : "0 48px 96px", gap: isMobile ? "48px" : "80px", position: "relative", zIndex: 1 }}
      >
        {/* Problem / Solution */}
        <div
          className={heroTextReady ? "hero-fade flex flex-col" : "flex flex-col"}
          style={{ gap: "20px", ...(heroTextReady ? { animationDelay: "280ms" } : { opacity: 0 }) }}
        >
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
            className="subtext"
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
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}
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
              body: "Fillers, pause patterns, and engagement heatmaps after every session.",
            },
          ].map((f) => (
            <div key={f.title} className="feature-card" style={{ padding: "36px" }}>
              <div style={{ fontSize: "1.6rem", marginBottom: "20px", color: "var(--aqua)" }}>
                {f.icon}
              </div>
              <h3 style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "12px", letterSpacing: "-0.01em" }}>
                {f.title}
              </h3>
              <p className="subtext" style={{ fontSize: "0.9rem", lineHeight: 1.7, color: "rgba(240,245,243,0.48)" }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center text-center overflow-hidden"
        style={{ padding: isMobile ? "72px 20px" : "120px 48px" }}
      >
        {/* Background marquee */}
        <div className="absolute inset-0 flex flex-col justify-center gap-0 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="marquee-track" style={{ opacity: 0.03 }}>
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                style={{ fontSize: "clamp(3rem, 7vw, 6rem)", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--aqua)", display: "inline-block" }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
              <span
                className={i % 2 === 0 ? "marquee-left" : "marquee-right"}
                aria-hidden="true"
                style={{ fontSize: "clamp(3rem, 7vw, 6rem)", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--aqua)", display: "inline-block" }}
              >
                {MARQUEE_TEXT.repeat(6)}
              </span>
            </div>
          ))}
        </div>

        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 30%, var(--bg) 80%)" }}
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col items-center" style={{ maxWidth: "640px", gap: "28px" }}>
          <h2 style={{ fontSize: "clamp(2.5rem, 7vw, 5.5rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1 }}>
            Get started.
          </h2>
          <div className="flex items-center flex-wrap justify-center" style={{ gap: "16px" }}>
            <Link href="/app" className="btn-pill btn-primary">Sign in →</Link>
            <Link href="/demo" className="btn-pill btn-ghost">Watch demo</Link>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────── */}
      <footer
        className="flex items-center justify-between border-t"
        style={{ borderColor: "rgba(45,255,192,0.08)", padding: isMobile ? "20px 20px" : "28px 48px" }}
      >
        <span style={{ fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--aqua)" }}>
          cue.
        </span>
        <p className="subtext" style={{ fontSize: "0.78rem", color: "rgba(240,245,243,0.22)" }}>
          © {new Date().getFullYear()} Cue. All rights reserved.
        </p>
      </footer>
    </main>
  );
}
