"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

interface Props {
  data: MetricDataPoint[];
  label: string;
  color?: string;
  yMin?: number;
  yMax?: number;
  unit?: string;
}

export default function MetricsChart({ data, label, color = "#2DFFC0", yMin, yMax, unit = "" }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center" style={{ height: "128px", color: "rgba(240,245,243,0.3)", fontSize: "0.875rem" }}>
        No data
      </div>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(240,245,243,0.4)", fontWeight: 600, marginBottom: "12px" }}>{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(45,255,192,0.08)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => { try { return format(new Date(v), "mm:ss"); } catch { return v; } }}
            tick={{ fontSize: 10, fill: "rgba(240,245,243,0.3)" }}
            minTickGap={40}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[yMin ?? "auto", yMax ?? "auto"]}
            tick={{ fontSize: 10, fill: "rgba(240,245,243,0.3)" }}
            width={36}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => [`${value}${unit}`, label]}
            labelFormatter={(l) => { try { return format(new Date(l), "HH:mm:ss"); } catch { return l; } }}
            contentStyle={{ background: "#0d1210", border: "1px solid rgba(45,255,192,0.15)", borderRadius: "10px", fontSize: "12px", color: "#f0f5f3" }}
          />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
