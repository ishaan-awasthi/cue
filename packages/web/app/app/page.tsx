import Link from "next/link";

export default function AppHomePage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-semibold text-gray-200">
          Select a session or create a new one
        </h2>
        <p className="text-sm text-gray-500">
          Choose a session from the sidebar to view its details, or start a new
          session to prepare with context upload and clarifying questions before
          your conversation.
        </p>
        <Link
          href="/app"
          className="inline-flex items-center justify-center rounded-lg bg-aqua px-4 py-2 text-sm font-medium text-gray-950 hover:bg-aqua-300 transition-colors"
        >
          New session
        </Link>
      </div>
    </div>
  );
}
