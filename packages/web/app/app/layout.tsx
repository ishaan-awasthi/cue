"use client";

import { useState } from "react";
import Link from "next/link";
import AppSidebar from "./AppSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* Mobile header */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between"
        style={{ padding: "12px 16px", borderBottom: "1px solid rgba(45,255,192,0.1)", background: "var(--bg)" }}
      >
        <Link
          href="/app"
          style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--aqua)" }}
        >
          cue.
        </Link>
        <button
          onClick={() => setSidebarOpen(true)}
          style={{ color: "var(--fg)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}
          aria-label="Open menu"
        >
          <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
            <rect width="22" height="1.5" rx="1" fill="currentColor" />
            <rect y="7.25" width="22" height="1.5" rx="1" fill="currentColor" />
            <rect y="14.5" width="22" height="1.5" rx="1" fill="currentColor" />
          </svg>
        </button>
      </header>

      {/* Backdrop (mobile) */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 w-60 shrink-0 flex flex-col z-50 transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={{ borderRight: "1px solid rgba(45,255,192,0.1)", background: "var(--bg)" }}
      >
        <div
          className="px-4 pt-4 pb-2 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(45,255,192,0.1)" }}
        >
          <Link
            href="/app"
            style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--aqua)" }}
          >
            cue.
          </Link>
          <button
            className="md:hidden"
            onClick={() => setSidebarOpen(false)}
            style={{ color: "rgba(240,245,243,0.5)", background: "none", border: "none", cursor: "pointer", padding: "4px" }}
            aria-label="Close menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <AppSidebar onNavigate={() => setSidebarOpen(false)} />
        <div className="p-3 mt-auto" style={{ borderTop: "1px solid rgba(45,255,192,0.1)" }}>
          <Link
            href="/app/practice"
            className="btn-pill btn-ghost"
            style={{ padding: "8px 16px", width: "100%", justifyContent: "center" }}
          >
            Practice
          </Link>
        </div>
      </aside>

      {/* Main — add top padding on mobile for fixed header */}
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">{children}</main>
    </div>
  );
}
