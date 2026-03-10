import Link from "next/link";
import { getMetrics, getCurrentUserId } from "../../lib/supabase";
import MetricsChart, { type MetricDataPoint } from "../../components/MetricsChart";

const METRIC_CONFIG: Array<{ key: string; label: string; unit: string; yMin?: number; yMax?: number }> = [
  { key: "avg_wpm",            label: "Speaking pace",           unit: " wpm", yMin: 0 },
  { key: "total_fillers",      label: "Filler words per session", unit: "",    yMin: 0 },
  { key: "avg_pitch_variance", label: "Pitch variance",           unit: "",    yMin: 0 },
  { key: "avg_volume_rms",     label: "Volume (RMS)",             unit: "",    yMin: 0 },
  { key: "overall_score",      label: "Overall score",            unit: "",    yMin: 0, yMax: 100 },
];

export default async function SkillsPage() {
  const allMetrics = await getMetrics(getCurrentUserId());

  const seriesMap: Record<string, MetricDataPoint[]> = {};
  for (const row of allMetrics) {
    if (!seriesMap[row.metric_name]) seriesMap[row.metric_name] = [];
    seriesMap[row.metric_name].push({ timestamp: row.recorded_at, value: row.value });
  }

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 16px", background: "var(--bg)", color: "var(--fg)", minHeight: "100vh" }}>
      <div className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "rgba(240,245,243,0.4)", marginBottom: "24px" }}>
        <Link href="/app" style={{ color: "rgba(240,245,243,0.4)" }}>Sessions</Link>
        <span style={{ color: "rgba(240,245,243,0.2)" }}>/</span>
        <span style={{ color: "rgba(240,245,243,0.6)" }}>Skills progress</span>
      </div>

      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 0.95, marginBottom: "8px" }}>
        Skills progress
      </h1>
      <p style={{ fontSize: "0.95rem", lineHeight: 1.7, color: "rgba(240,245,243,0.5)", marginBottom: "40px" }}>
        Long-term trends across all your sessions.
      </p>

      {allMetrics.length === 0 ? (
        <div className="feature-card" style={{ border: "1px dashed rgba(45,255,192,0.15)", padding: "40px", textAlign: "center", fontSize: "0.875rem", color: "rgba(240,245,243,0.4)" }}>
          No session data yet. Complete at least one session to see your trends.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {METRIC_CONFIG.map(({ key, label, unit, yMin, yMax }) => {
            const series = seriesMap[key] ?? [];
            return (
              <section key={key} className="feature-card" style={{ padding: "20px" }}>
                <MetricsChart data={series} label={label} unit={unit} yMin={yMin} yMax={yMax} />
                {series.length > 1 && (
                  <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.3)", fontWeight: 600, marginTop: "12px" }}>
                    {series.length} data points
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
