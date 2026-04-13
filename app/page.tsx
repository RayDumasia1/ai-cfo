"use client";

import { useMemo, useState } from "react";
import DashboardLayout from "./components/DashboardLayout";
import StatCard from "./components/StatCard";
import { calculateFinancials } from "@/lib/calculations";
import type { FinancialSnapshot } from "@/lib/types";

// ── Presentation utility (formatting only, not calculation) ───────
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Home() {
  const [cash, setCash] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // ── Data layer ────────────────────────────────────────────────────
  // Today: reads from form inputs.
  // Future: swap this useMemo for a hook that reads from QuickBooks /
  // banking API — calculateFinancials() and the UI below stay the same.
  const snapshot = useMemo<FinancialSnapshot | null>(() => {
    if (!submitted) return null;

    const cashValue = Number(cash);
    const revenueValue = Number(revenue);
    const expenseValue = Number(expenses);

    if (
      cash.trim() === "" ||
      revenue.trim() === "" ||
      expenses.trim() === "" ||
      Number.isNaN(cashValue) ||
      Number.isNaN(revenueValue) ||
      Number.isNaN(expenseValue) ||
      cashValue < 0 ||
      revenueValue < 0 ||
      expenseValue < 0
    ) {
      return null;
    }

    return calculateFinancials({
      cashBalance: cashValue,
      monthlyRevenue: revenueValue,
      monthlyExpenses: expenseValue,
    });
  }, [cash, revenue, expenses, submitted]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  // ── Display-layer derivations — formatting only, zero math ────────
  const cashDisplay = snapshot ? formatCurrency(snapshot.cashPosition) : "—";
  const burnDisplay = snapshot
    ? snapshot.riskLevel === "Healthy" && snapshot.burnRate < 0
      ? `+${formatCurrency(Math.abs(snapshot.burnRate))}`
      : formatCurrency(snapshot.burnRate)
    : "—";
  const runwayDisplay = snapshot
    ? snapshot.runwayMonths !== null
      ? `${snapshot.runwayMonths.toFixed(1)} mo`
      : "Stable"
    : "—";
  const cashOutDisplay = snapshot ? (snapshot.runoutDate ?? "Stable") : "—";

  const riskColors = {
    High:    "bg-red-50     text-red-600     border-red-200",
    Medium:  "bg-amber-50   text-amber-600   border-amber-200",
    Low:     "bg-emerald-50 text-emerald-600 border-emerald-200",
    Healthy: "bg-teal/10    text-teal         border-teal/20",
  } as const;

  return (
    <DashboardLayout>
      <div className="px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-medium text-ink">Dashboard</h1>
          <p className="mt-1 text-sm font-light text-dim">
            Enter your numbers below to see your financial snapshot.
          </p>
        </div>

        {/* Stat cards — 2 cols on mobile, 4 on large */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
          <StatCard label="Cash Position" value={cashDisplay} />
          <StatCard label="Monthly Burn"  value={burnDisplay} />
          <StatCard label="Runway"        value={runwayDisplay} />
          <StatCard label="Cash-Out Date" value={cashOutDisplay} highlight />
        </div>

        {/* Insight + risk badge */}
        {snapshot && (
          <div
            className="mb-8 bg-surface max-w-2xl"
            style={{
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-sm)",
              padding: "1.25rem 1.5rem",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <p
                className="text-[11px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--dim)" }}
              >
                AI CFO Insight
              </p>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 border ${riskColors[snapshot.riskLevel]}`}
                style={{ borderRadius: "var(--radius-sm)" }}
              >
                {snapshot.riskLevel} risk
              </span>
            </div>
            <p className="text-sm font-light leading-relaxed text-ink">
              {snapshot.summary}
            </p>
          </div>
        )}

        {/* Calculator */}
        <section
          className="bg-surface max-w-lg"
          style={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow-sm)",
            padding: "1.5rem",
          }}
        >
          <h2 className="text-base font-medium text-ink">Update Inputs</h2>
          <p className="mt-1 text-sm font-light text-dim">
            Adjust these to explore different scenarios.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="cash"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                Current cash balance
              </label>
              <input
                id="cash"
                type="number"
                min="0"
                step="any"
                placeholder="50000"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                className="w-full border border-line px-4 py-2.5 text-sm text-ink bg-cloud outline-none transition focus:border-teal"
                style={{ borderRadius: "var(--radius-sm)" }}
              />
            </div>

            <div>
              <label
                htmlFor="revenue"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                Average monthly revenue
              </label>
              <input
                id="revenue"
                type="number"
                min="0"
                step="any"
                placeholder="25000"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="w-full border border-line px-4 py-2.5 text-sm text-ink bg-cloud outline-none transition focus:border-teal"
                style={{ borderRadius: "var(--radius-sm)" }}
              />
            </div>

            <div>
              <label
                htmlFor="expenses"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                Average monthly expenses
              </label>
              <input
                id="expenses"
                type="number"
                min="0"
                step="any"
                placeholder="30000"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
                className="w-full border border-line px-4 py-2.5 text-sm text-ink bg-cloud outline-none transition focus:border-teal"
                style={{ borderRadius: "var(--radius-sm)" }}
              />
            </div>

            {submitted && !snapshot && (
              <p className="text-xs text-red-500">
                Please enter valid positive numbers in all three fields.
              </p>
            )}

            <button
              type="submit"
              className="w-full px-5 py-2.5 text-sm font-medium text-white bg-teal transition hover:bg-teal/90"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              Calculate My Runway
            </button>
          </form>
        </section>

      </div>
    </DashboardLayout>
  );
}
