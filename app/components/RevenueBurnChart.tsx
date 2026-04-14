"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { getRevenueVsBurnChartData } from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
}

interface TooltipArgs {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

interface RevenueBurnChartProps {
  months: FinancialMonth[];
}

function formatDollars(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatYAxis(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function ChartTooltip({ active, payload, label }: TooltipArgs) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #D8E2EC",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        color: "#0A1A2F",
        boxShadow: "0 2px 8px rgba(10,26,47,0.10)",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{String(label)}</p>
      {payload.map((entry: TooltipEntry) => (
        <p key={String(entry.name)} style={{ color: entry.color, margin: "2px 0" }}>
          {entry.name}: {formatDollars(Number(entry.value))}
        </p>
      ))}
    </div>
  );
}

export default function RevenueBurnChart({ months }: RevenueBurnChartProps) {
  const { labels, revenue, burn } = getRevenueVsBurnChartData(months);

  if (labels.length === 0) return null;

  const chartData = labels.map((label, i) => ({
    label,
    Revenue: revenue[i],
    "Burn Rate": burn[i],
  }));

  const lastRevenue = revenue[revenue.length - 1] ?? 0;
  const lastBurn = burn[burn.length - 1] ?? 0;
  const revenueLeading = lastRevenue > lastBurn;

  const insightText = revenueLeading
    ? "Revenue exceeding burn — positive cash flow"
    : "Burn exceeding revenue — negative cash flow";
  const insightColor = revenueLeading ? "var(--teal)" : "#ef4444";

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #D8E2EC",
        borderRadius: "var(--radius-lg, 16px)",
        boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
        padding: "24px",
      }}
    >
      {/* Header */}
      <div className="mb-4">
        <p
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#0A1A2F",
            margin: 0,
          }}
        >
          Revenue vs Burn &nbsp;·&nbsp; Last 6 months
        </p>
        <p style={{ fontSize: 12, color: insightColor, marginTop: 4 }}>
          {insightText}
        </p>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2CA6A4" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#2CA6A4" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#E84545" stopOpacity={0.06} />
              <stop offset="95%" stopColor="#E84545" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            horizontal
            vertical={false}
            stroke="#D8E2EC"
            strokeOpacity={0.4}
          />

          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#6B7A8D" }}
          />

          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#6B7A8D" }}
            tickFormatter={formatYAxis}
            width={48}
          />

          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip content={ChartTooltip as any} />

          <Line
            type="monotone"
            dataKey="Revenue"
            stroke="#2CA6A4"
            strokeWidth={2}
            dot={{ r: 3, fill: "#2CA6A4", strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />

          <Line
            type="monotone"
            dataKey="Burn Rate"
            stroke="#E84545"
            strokeWidth={2}
            dot={{ r: 3, fill: "#E84545", strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div
        className="flex justify-center gap-6 mt-3"
        style={{ fontSize: 12, color: "#6B7A8D" }}
      >
        <div className="flex items-center gap-1.5">
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: "#2CA6A4",
            }}
          />
          Revenue
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: "#E84545",
            }}
          />
          Burn Rate
        </div>
      </div>
    </div>
  );
}
