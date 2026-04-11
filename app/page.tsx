"use client";

import { useMemo, useState } from "react";

type ResultState = {
  burn: number;
  runwayMonths: number | null;
  summary: string;
  riskLevel: "Low" | "Medium" | "High" | "Healthy";
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getRiskLevel(runwayMonths: number): "Low" | "Medium" | "High" {
  if (runwayMonths >= 6) return "Low";
  if (runwayMonths >= 3) return "Medium";
  return "High";
}

export default function Home() {
  const [cash, setCash] = useState("");
  const [revenue, setRevenue] = useState("");
  const [expenses, setExpenses] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const result = useMemo<ResultState | null>(() => {
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
      return {
        burn: 0,
        runwayMonths: null,
        summary: "Please enter valid positive numbers in all three fields.",
        riskLevel: "High",
      };
    }

    const burn = expenseValue - revenueValue;

    if (burn < 0) {
      return {
        burn,
        runwayMonths: null,
        summary:
          "You are currently generating more revenue than expenses each month. You are not burning cash at your current pace.",
        riskLevel: "Healthy",
      };
    }

    if (burn === 0) {
      return {
        burn,
        runwayMonths: null,
        summary:
          "You are currently break-even. Your cash position is stable as long as revenue and expenses stay at this level.",
        riskLevel: "Healthy",
      };
    }

    const runwayMonths = cashValue / burn;
    const riskLevel = getRiskLevel(runwayMonths);

    return {
      burn,
      runwayMonths,
      summary: `At your current pace, you have about ${runwayMonths.toFixed(
        1
      )} months of runway remaining.`,
      riskLevel,
    };
  }, [cash, revenue, expenses, submitted]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <section className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            AI CFO
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Get instant visibility into your cash runway
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            Enter three numbers to quickly understand your burn, runway, and
            current financial risk.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Runway Calculator</h2>
            <p className="mt-2 text-sm text-slate-600">
              No signup required. Start with your current cash, average monthly
              revenue, and average monthly expenses.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div>
                <label
                  htmlFor="cash"
                  className="mb-2 block text-sm font-medium text-slate-700"
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
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="revenue"
                  className="mb-2 block text-sm font-medium text-slate-700"
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
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="expenses"
                  className="mb-2 block text-sm font-medium text-slate-700"
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
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-800"
              >
                Calculate My Runway
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Your Result</h2>
            <p className="mt-2 text-sm text-slate-600">
              This is your first version. Keep it simple and test with real
              numbers.
            </p>

            {!submitted && (
              <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-600">
                Enter your numbers and click <strong>Calculate My Runway</strong>{" "}
                to see your burn and runway summary here.
              </div>
            )}

            {submitted && result && (
              <div className="mt-8 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-5">
                    <p className="text-sm text-slate-500">Monthly burn</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {result.riskLevel === "Healthy" && result.burn < 0
                        ? `${formatCurrency(Math.abs(result.burn))} positive`
                        : formatCurrency(result.burn)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-5">
                    <p className="text-sm text-slate-500">Runway</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {result.runwayMonths === null
                        ? result.riskLevel === "Healthy"
                          ? "Stable"
                          : "—"
                        : `${result.runwayMonths.toFixed(1)} months`}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-5">
                  <p className="text-sm text-slate-500">Risk level</p>
                  <p className="mt-2 text-lg font-semibold">
                    {result.riskLevel}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 p-5">
                  <p className="text-sm text-slate-500">AI CFO insight</p>
                  <p className="mt-2 leading-7 text-slate-700">
                    {result.summary}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
