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
import { BarChart2 } from "lucide-react";
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
      {payload.map((entry: TooltipEntry) => {
        const displayValue =
          entry.value == null || entry.value === ""
            ? "—"
            : formatDollars(Number(entry.value));
        return (
          <p key={String(entry.name)} style={{ color: entry.color, margin: "2px 0" }}>
            {entry.name}: {displayValue}
          </p>
        );
      })}
    </div>
  );
}

// Matches the total height of the populated card so there is no layout shift:
// 24px pad-top + ~24px header block + 16px gap + 200px chart + ~28px legend + 24px pad-bottom
const CARD_STYLE: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #D8E2EC",
  borderRadius: "var(--radius-lg, 16px)",
  boxShadow: "0 1px 3px rgba(10,26,47,0.08)",
  padding: "24px",
  minHeight: 316,
};

export default function RevenueBurnChart({ months }: RevenueBurnChartProps) {
  const chartResult = getRevenueVsBurnChartData(months);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!chartResult) {
    return (
      <div style={CARD_STYLE}>
        {/* Title row — same position as populated state */}
        <p style={{ fontSize: 13, fontWeight: 600, color: "#0A1A2F", margin: 0 }}>
          Revenue vs Burn &nbsp;·&nbsp; No data yet
        </p>

        {/* Centred placeholder body */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            minHeight: 200,
            gap: 12,
            paddingTop: 16,
          }}
        >
          <BarChart2 size={32} color="#D8E2EC" strokeWidth={1.5} />
          <p
            style={{
              fontSize: 13,
              color: "#6B7A8D",
              textAlign: "center",
              maxWidth: 280,
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Upload your financial data to see your revenue vs burn trend.
          </p>
          <a
            href="#import"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("import-section")?.scrollIntoView({ behavior: "smooth" });
            }}
            style={{ fontSize: 13, color: "#2CA6A4", textDecoration: "none" }}
          >
            Upload data →
          </a>
        </div>
      </div>
    );
  }

  const { labels, revenue, burn } = chartResult;
  const count = labels.length;

  // Dynamic title suffix
  const periodLabel = count === 1 ? "Last month" : `Last ${count} months`;

  const chartData = labels.map((label, i) => ({
    label,
    // Pass null through so Recharts omits the point rather than plotting $0
    Revenue: revenue[i],
    "Burn Rate": burn[i],
  }));

  // Insight line: compare last month's values (null-safe)
  const lastRevenue = revenue[count - 1];
  const lastBurn = burn[count - 1];
  let insightText: string;
  let insightColor: string;
  if (lastRevenue != null && lastBurn != null) {
    if (lastRevenue > lastBurn) {
      insightText = "Revenue exceeding burn — positive cash flow";
      insightColor = "var(--teal)";
    } else {
      insightText = "Burn exceeding revenue — negative cash flow";
      insightColor = "#ef4444";
    }
  } else {
    insightText = "Revenue vs expenses — month data";
    insightColor = "#6B7A8D";
  }

  return (
    <div style={CARD_STYLE}>
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
          Revenue vs Burn &nbsp;·&nbsp; {periodLabel}
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
