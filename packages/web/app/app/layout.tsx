import Link from "next/link";
import AppSidebar from "./AppSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-gray-800 flex flex-col bg-gray-900/30">
        <div className="p-3 border-b border-gray-800">
          <Link href="/app" className="text-lg font-semibold text-white">
            Cue
          </Link>
        </div>
        <AppSidebar />
        <div className="p-3 mt-auto border-t border-gray-800">
          <Link
            href="/app/practice"
            className="block w-full rounded-lg bg-gray-800 px-3 py-2.5 text-sm font-medium text-gray-200 hover:bg-gray-700 hover:text-aqua transition-colors text-center"
          >
            Practice from session
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
