"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

interface Props {
  data: MetricDataPoint[];
  label: string;
  color?: string;
  /** Minimum Y value (default: auto) */
  yMin?: number;
  /** Maximum Y value (default: auto) */
  yMax?: number;
  /** Unit suffix shown in tooltip, e.g. " wpm" */
  unit?: string;
}

export default function MetricsChart({
  data,
  label,
  color = "#6366f1",
  yMin,
  yMax,
  unit = "",
}: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        No data
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => {
              try {
                return format(new Date(v), "mm:ss");
              } catch {
                return v;
              }
            }}
            tick={{ fontSize: 10, fill: "#6b7280" }}
            minTickGap={40}
          />
          <YAxis
            domain={[yMin ?? "auto", yMax ?? "auto"]}
            tick={{ fontSize: 10, fill: "#6b7280" }}
            width={40}
          />
          <Tooltip
            formatter={(value: number) => [`${value}${unit}`, label]}
            labelFormatter={(l) => {
              try {
                return format(new Date(l), "HH:mm:ss");
              } catch {
                return l;
              }
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
