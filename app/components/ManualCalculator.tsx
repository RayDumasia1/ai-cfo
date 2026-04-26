"use client";

import { useMemo, useState } from "react";
import StatCard from "./StatCard";
import { calculateFinancials } from "@/lib/calculations";
import type { FinancialSnapshot } from "@/lib/types";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

const riskColors = {
  High:    "bg-red-50     text-red-600     border-red-200",
  Medium:  "bg-amber-50   text-amber-600   border-amber-200",
  Low:     "bg-emerald-50 text-emerald-600 border-emerald-200",
  Healthy: "bg-teal/10    text-teal         border-teal/20",
} as const;

function CalculatorForm({
  cash, setCash,
  revenue, setRevenue,
  expenses, setExpenses,
  submitted, snapshot,
  onSubmit,
}: {
  cash: string; setCash: (v: string) => void;
  revenue: string; setRevenue: (v: string) => void;
  expenses: string; setExpenses: (v: string) => void;
  submitted: boolean; snapshot: FinancialSnapshot | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="mc-cash" className="block text-xs font-medium text-ink mb-1.5">
          Current cash balance
        </label>
        <input
          id="mc-cash"
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
        <label htmlFor="mc-revenue" className="block text-xs font-medium text-ink mb-1.5">
          Average monthly revenue
        </label>
        <input
          id="mc-revenue"
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
        <label htmlFor="mc-expenses" className="block text-xs font-medium text-ink mb-1.5">
          Average monthly expenses
        </label>
        <input
          id="mc-expenses"
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
  );
}

export default function ManualCalculator({ bare = false }: { bare?: boolean }) {
  const [cash, setCash] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [submitted, setSubmitted] = useState(false);

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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
  }

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

  return (
    <div>
      {snapshot && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-6">
          <StatCard label="Cash Position" value={cashDisplay} />
          <StatCard label="Monthly Burn" value={burnDisplay} />
          <StatCard label="Runway" value={runwayDisplay} />
          <StatCard label="Cash-Out Date" value={cashOutDisplay} highlight />
        </div>
      )}

      {snapshot && (
        <div
          className="mb-6 bg-surface"
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

      {bare ? (
        <CalculatorForm
          cash={cash} setCash={setCash}
          revenue={revenue} setRevenue={setRevenue}
          expenses={expenses} setExpenses={setExpenses}
          submitted={submitted} snapshot={snapshot}
          onSubmit={handleSubmit}
        />
      ) : (
        <section
          className="bg-surface max-w-lg"
          style={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow-sm)",
            padding: "1.5rem",
          }}
        >
          <h2 className="text-base font-medium text-ink">What-If Scenario</h2>
          <p className="mt-1 text-sm font-light text-dim">
            Enter numbers manually to explore scenarios.
          </p>
          <div className="mt-6">
            <CalculatorForm
              cash={cash} setCash={setCash}
              revenue={revenue} setRevenue={setRevenue}
              expenses={expenses} setExpenses={setExpenses}
              submitted={submitted} snapshot={snapshot}
              onSubmit={handleSubmit}
            />
          </div>
        </section>
      )}
    </div>
  );
}
