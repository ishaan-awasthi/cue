import Link from "next/link";
import AppSidebar from "./AppSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* Sidebar */}
      <aside
        className="w-60 shrink-0 flex flex-col"
        style={{ borderRight: "1px solid rgba(45,255,192,0.1)" }}
      >
        <div className="px-4 pt-4 pb-2" style={{ borderBottom: "1px solid rgba(45,255,192,0.1)" }}>
          <Link
            href="/app"
            style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--aqua)" }}
          >
            cue.
          </Link>
        </div>
        <AppSidebar />
        <div className="p-3 mt-auto" style={{ borderTop: "1px solid rgba(45,255,192,0.1)" }}>
          <Link href="/app/practice" className="btn-pill btn-ghost" style={{ padding: "8px 16px", width: "100%", justifyContent: "center" }}>
            Practice
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
