import Link from "next/link";
import { listSessions } from "../lib/supabase";
import { format, formatDuration, intervalToDuration } from "date-fns";

const USER_ID = process.env.NEXT_PUBLIC_USER_ID ?? "00000000-0000-0000-0000-000000000001";

function scoreColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function formatDur(seconds: number | null): string {
  if (!seconds) return "—";
  const dur = intervalToDuration({ start: 0, end: seconds * 1000 });
  return formatDuration(dur, { format: ["minutes", "seconds"] });
}

export default async function HomePage() {
  const sessions = await listSessions(USER_ID);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time presentation coach</p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/files" className="text-indigo-600 hover:underline">
            Reference Files
          </Link>
          <Link href="/skills" className="text-indigo-600 hover:underline">
            Skills Progress
          </Link>
        </nav>
      </div>

      {/* Sessions list */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Past Sessions</h2>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400 text-sm">
            No sessions yet. Start a live session from the glasses rig to see your coaching history here.
          </div>
        ) : (
          <ul className="space-y-3">
            {sessions.map((s) => {
              // Extract top issues from summary
              const summary = s.summary as Record<string, unknown> | null;
              const filler = summary?.filler_rate_per_min as number | undefined;
              const wpm = summary?.avg_wpm as number | undefined;

              const issues: string[] = [];
              if (filler != null && filler > 3) issues.push(`${filler.toFixed(1)} fillers/min`);
              if (wpm != null && wpm > 180) issues.push("spoke too fast");
              if (wpm != null && wpm < 100) issues.push("spoke too slowly");

              return (
                <li key={s.id}>
                  <Link
                    href={`/sessions/${s.id}`}
                    className="block rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {s.started_at
                            ? format(new Date(s.started_at), "MMM d, yyyy — h:mm a")
                            : "Unknown date"}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Duration: {formatDur(s.duration_seconds)}
                        </p>
                        {issues.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {issues.map((issue) => (
                              <span
                                key={issue}
                                className="inline-block rounded-full bg-red-50 text-red-600 text-[10px] px-2 py-0.5 border border-red-200"
                              >
                                {issue}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`text-2xl font-bold ${scoreColor(s.overall_score)}`}
                        >
                          {s.overall_score != null ? Math.round(s.overall_score) : "—"}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">score</p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
