import Link from "next/link";
import { getMetrics } from "../../lib/supabase";
import MetricsChart, { type MetricDataPoint } from "../../components/MetricsChart";

const USER_ID = process.env.NEXT_PUBLIC_USER_ID ?? "00000000-0000-0000-0000-000000000001";

const METRIC_CONFIG: Array<{
  key: string;
  label: string;
  color: string;
  unit: string;
  yMin?: number;
  yMax?: number;
}> = [
  { key: "avg_wpm",           label: "Speaking Pace (WPM)",    color: "#00d4aa", unit: " wpm",   yMin: 0 },
  { key: "total_fillers",     label: "Filler Words per Session", color: "#00d4aa", unit: "",       yMin: 0 },
  { key: "avg_pitch_variance",label: "Pitch Variance",          color: "#00d4aa", unit: "",       yMin: 0 },
  { key: "avg_volume_rms",    label: "Volume (RMS)",            color: "#00d4aa", unit: "",       yMin: 0 },
  { key: "overall_score",     label: "Overall Score",           color: "#00d4aa", unit: "",       yMin: 0, yMax: 100 },
];

export default async function SkillsPage() {
  const allMetrics = await getMetrics(USER_ID);

  // Group by metric_name → series of (recorded_at, value)
  const seriesMap: Record<string, MetricDataPoint[]> = {};
  for (const row of allMetrics) {
    if (!seriesMap[row.metric_name]) seriesMap[row.metric_name] = [];
    seriesMap[row.metric_name].push({
      timestamp: row.recorded_at,
      value: row.value,
    });
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 bg-gray-950 text-gray-100 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href="/app" className="hover:text-aqua transition-colors">Sessions</Link>
        <span>/</span>
        <span className="text-gray-400">Skills Progress</span>
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Skills Progress</h1>
      <p className="text-sm text-gray-500 mb-8">
        Long-term trends across all your sessions. Keep an eye on which metrics
        are improving and which still need work.
      </p>

      {allMetrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-10 text-center text-gray-500 text-sm">
          No session data yet. Complete at least one session to see your trends.
        </div>
      ) : (
        <div className="space-y-10">
          {METRIC_CONFIG.map(({ key, label, color, unit, yMin, yMax }) => {
            const series = seriesMap[key] ?? [];
            return (
              <section key={key} className="rounded-xl border border-gray-700 bg-gray-900/50 p-5">
                <MetricsChart
                  data={series}
                  label={label}
                  color={color}
                  unit={unit}
                  yMin={yMin}
                  yMax={yMax}
                />
                {series.length > 1 && (
                  <p className="text-xs text-gray-500 mt-3">
                    {series.length} data points across {series.length} sessions
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
