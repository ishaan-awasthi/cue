"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { format } from "date-fns";
import type { MetricDataPoint } from "./MetricsChart";

interface Props {
  data: MetricDataPoint[];
}

/** Returns a CSS color string based on attention score 0–1. */
function attentionColor(score: number): string {
  if (score >= 0.75) return "#00d4aa"; // aqua
  if (score >= 0.5) return "#737373";  // gray
  return "#525252";                    // gray-600
}

// Custom dot to colour by value
function ColoredDot(props: {
  cx?: number;
  cy?: number;
  payload?: { value: number };
}) {
  const { cx = 0, cy = 0, payload } = props;
  const color = attentionColor(payload?.value ?? 1);
  return <circle cx={cx} cy={cy} r={4} fill={color} />;
}

export default function AttentionHeatmap({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        No audience data
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-sm font-medium text-gray-300 mb-2">Audience Attention</p>

      {/* Gradient colour bar */}
      <div className="flex w-full h-3 rounded overflow-hidden mb-3">
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              backgroundColor: attentionColor(d.value),
            }}
            title={`${Math.round(d.value * 100)}% at ${d.timestamp}`}
          />
        ))}
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="attentionGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#00d4aa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => {
              try {
                return format(new Date(v), "mm:ss");
              } catch {
                return v;
              }
            }}
            tick={{ fontSize: 10, fill: "#a3a3a3" }}
            minTickGap={40}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 10, fill: "#a3a3a3" }}
            width={40}
          />
          <Tooltip
            formatter={(v: number) => [`${Math.round(v * 100)}%`, "Attention"]}
            labelFormatter={(l) => {
              try {
                return format(new Date(l), "HH:mm:ss");
              } catch {
                return l;
              }
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#00d4aa"
            fill="url(#attentionGrad)"
            strokeWidth={2}
            dot={<ColoredDot />}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-aqua" /> Engaged ≥ 75%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-gray-500" /> Drifting 50–74%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-gray-600" /> Lost &lt; 50%
        </span>
      </div>
    </div>
  );
}
