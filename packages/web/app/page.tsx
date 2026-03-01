import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header with Login */}
      <header className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-lg font-semibold text-white">Cue</span>
          <Link
            href="/app"
            className="text-sm font-medium text-aqua hover:text-aqua-300 transition-colors"
          >
            Login
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">
            Real-time insights and feedback to improve your public speaking
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed">
            A full platform that provides real-time insights and feedback to improve
            public speaking ability. Practice with context, get live nudges, and review
            detailed ratings and coaching after every session.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-lg bg-aqua px-6 py-3 text-sm font-medium text-gray-950 hover:bg-aqua-300 transition-colors"
            >
              Get started
            </Link>
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-lg border border-gray-600 px-6 py-3 text-sm font-medium text-gray-200 hover:border-aqua hover:text-aqua transition-colors"
            >
              Login
            </Link>
          </div>
        </div>

        {/* Value props */}
        <section className="max-w-3xl mx-auto mt-24 grid sm:grid-cols-3 gap-8 text-center">
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <p className="text-aqua text-sm font-medium mb-2">Live coaching</p>
            <p className="text-gray-400 text-sm">
              Real-time nudges on pace, fillers, and audience attention during your presentation.
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <p className="text-aqua text-sm font-medium mb-2">Context-aware</p>
            <p className="text-gray-400 text-sm">
              Upload slides and notes. Get whispered answers when the audience asks questions.
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
            <p className="text-aqua text-sm font-medium mb-2">Track progress</p>
            <p className="text-gray-400 text-sm">
              Session ratings, filler words, speed, retention, and actionable coaching reports.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
