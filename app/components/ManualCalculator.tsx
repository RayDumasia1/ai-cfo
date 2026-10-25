"use client";

import { useMemo, useState } from "react";
import { operatingCashMetrics, type OperatingCashMetrics } from "@/lib/normalizedCashHealth";
import type { ScenarioBaseline } from "@/lib/scenarioPlanning";

type EventType = "none" | "receipt" | "payment";
type ScenarioResult = OperatingCashMetrics & { availableCash: number };

function amount(value: string): number | null {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function months(value: number | null): string {
  return value === null ? "Not applicable" : `${value.toFixed(1)} months`;
}

function signedMoney(value: number, currency: string): string {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${money(Math.abs(value), currency)}`;
}

function cashFlow(value: number, currency: string): string {
  if (value > 0) return `${money(value, currency)} surplus`;
  if (value < 0) return `${money(Math.abs(value), currency)} shortfall`;
  return "Break-even";
}

function cashFlowImpact(value: number, currency: string): string {
  if (value > 0) return `${money(value, currency)} better`;
  if (value < 0) return `${money(Math.abs(value), currency)} worse`;
  return "No change";
}

function signedMonths(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.05) return "No change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} months`;
}

function scenarioResult(cash: number, collected: number, paid: number): ScenarioResult {
  return { availableCash: cash, ...operatingCashMetrics(cash, collected, paid) };
}

function scenarioSummary(current: ScenarioResult, proposed: ScenarioResult, currency: string): string {
  const flowChange = proposed.averageNetCashFlow - current.averageNetCashFlow;
  const cashChange = proposed.availableCash - current.availableCash;
  const runwayChange = current.estimatedRunwayMonths !== null && proposed.estimatedRunwayMonths !== null
    ? proposed.estimatedRunwayMonths - current.estimatedRunwayMonths : null;
  const parts: string[] = [];
  if (flowChange > 0) parts.push(`Monthly operating cash flow improves by ${money(flowChange, currency)}.`);
  else if (flowChange < 0) parts.push(`Monthly operating cash flow declines by ${money(Math.abs(flowChange), currency)}.`);
  else parts.push("Monthly operating cash flow is unchanged.");
  if (cashChange > 0) parts.push(`Available cash increases by ${money(cashChange, currency)}.`);
  else if (cashChange < 0) parts.push(`Available cash decreases by ${money(Math.abs(cashChange), currency)}.`);
  if (runwayChange !== null && Math.abs(runwayChange) >= 0.05) {
    parts.push(`Estimated operating runway ${runwayChange > 0 ? "increases" : "decreases"} by ${Math.abs(runwayChange).toFixed(1)} months.`);
  } else if (current.estimatedRunwayMonths === null && proposed.estimatedRunwayMonths !== null) {
    parts.push("The scenario creates an operating cash shortfall, so an operating runway is now estimated.");
  } else if (current.estimatedRunwayMonths !== null && proposed.estimatedRunwayMonths === null) {
    parts.push("The scenario removes the operating cash shortfall, so a depletion runway is no longer projected.");
  }
  return parts.join(" ");
}

const inputClass = "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/20 disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "mb-1.5 block text-[10px] font-medium uppercase tracking-[0.1em] text-dim";

function ComparisonTable({ current, proposed, currency }: { current: ScenarioResult; proposed: ScenarioResult; currency: string }) {
  const runwayChange = current.estimatedRunwayMonths !== null && proposed.estimatedRunwayMonths !== null
    ? proposed.estimatedRunwayMonths - current.estimatedRunwayMonths : null;
  const rows = [
    ["Available cash", money(current.availableCash, currency), money(proposed.availableCash, currency), signedMoney(proposed.availableCash-current.availableCash, currency)],
    ["Monthly cash surplus or shortfall", cashFlow(current.averageNetCashFlow, currency), cashFlow(proposed.averageNetCashFlow, currency), cashFlowImpact(proposed.averageNetCashFlow-current.averageNetCashFlow, currency)],
    ["Cash buffer", months(current.cashCoverageMonths), months(proposed.cashCoverageMonths), signedMonths(current.cashCoverageMonths !== null && proposed.cashCoverageMonths !== null ? proposed.cashCoverageMonths-current.cashCoverageMonths : null)],
    ["Estimated cash runway", months(current.estimatedRunwayMonths), months(proposed.estimatedRunwayMonths), signedMonths(runwayChange)],
  ];
  return (
    <div className="mt-5 overflow-x-auto" aria-live="polite">
      <table className="w-full min-w-[540px] border-collapse text-left text-xs">
        <caption className="sr-only">Current financial baseline compared with the proposed scenario</caption>
        <thead><tr className="border-b border-line text-dim">
            <th className="px-2 py-2 font-medium">Metric</th><th className="px-2 py-2 font-medium">Current</th>
          <th className="px-2 py-2 font-medium">With changes</th><th className="px-2 py-2 font-medium">Impact</th>
        </tr></thead>
        <tbody>{rows.map(([label,currentValue,proposedValue,change]) => (
          <tr key={label} className="border-b border-line last:border-0">
            <th className="px-2 py-2.5 font-medium text-ink">{label}</th><td className="px-2 py-2.5 text-dim">{currentValue}</td>
            <td className="px-2 py-2.5 font-medium text-ink">{proposedValue}</td><td className="px-2 py-2.5 text-dim">{change}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-xs leading-relaxed text-ink">{scenarioSummary(current, proposed, currency)}</p>
    </div>
  );
}

export default function ManualCalculator({ bare = false, baseline, hasData = false }: { bare?: boolean; baseline?: ScenarioBaseline; hasData?: boolean }) {
  const ready = baseline?.status === "ready" && baseline.availableCash !== null
    && baseline.monthlyCashCollected !== null && baseline.monthlyOperatingCashPaid !== null;
  const currency = baseline?.currency ?? "USD";
  const [expectedCollections, setExpectedCollections] = useState("");
  const [expectedSpending, setExpectedSpending] = useState("");
  const [eventType, setEventType] = useState<EventType>("none");
  const [eventAmount, setEventAmount] = useState("");
  const [manualCash, setManualCash] = useState("");
  const [manualCollected, setManualCollected] = useState("");
  const [manualPaid, setManualPaid] = useState("");
  const [proposed, setProposed] = useState<ScenarioResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const current = useMemo(() => ready
    ? scenarioResult(baseline.availableCash!, baseline.monthlyCashCollected!, baseline.monthlyOperatingCashPaid!) : null,
  [ready, baseline]);

  function reset() {
    setExpectedCollections(""); setExpectedSpending(""); setEventType("none"); setEventAmount("");
    setManualCash(""); setManualCollected(""); setManualPaid(""); setProposed(null); setValidationError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const collections = amount(ready ? expectedCollections : manualCollected);
    const spending = amount(ready ? expectedSpending : manualPaid);
    const cash = amount(ready ? eventAmount : manualCash);
    if (collections === null || spending === null || cash === null || (!ready && (cash < 0 || collections < 0 || spending < 0))) {
      setValidationError("Enter valid amounts. Manual starting values cannot be negative."); setProposed(null); return;
    }
    if (ready) {
      const nextCollected = expectedCollections.trim() === "" ? baseline.monthlyCashCollected! : collections;
      const nextPaid = expectedSpending.trim() === "" ? baseline.monthlyOperatingCashPaid! : spending;
      const nextCash = baseline.availableCash! + (eventType === "receipt" ? cash : eventType === "payment" ? -cash : 0);
      if (nextCollected < 0 || nextPaid < 0 || nextCash < 0 || cash < 0) {
        setValidationError("This change would make collections, spending, or available cash negative. Reduce the adjustment."); setProposed(null); return;
      }
      setProposed(scenarioResult(nextCash, nextCollected, nextPaid));
    } else setProposed(scenarioResult(cash, collections, spending));
    setValidationError(null);
  }

  const actions = <div className="mt-4 flex flex-wrap gap-3">
    <button type="submit" className="rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">{ready ? "See impact" : "Calculate scenario"}</button>
    <button type="button" onClick={reset} className="rounded-md border border-line px-4 py-2.5 text-sm font-medium text-dim hover:text-ink">{ready ? "Reset changes" : "Clear"}</button>
  </div>;

  const body = ready && current ? <>
    <div className="mb-4 rounded-md border border-line bg-bg px-3 py-2 text-xs text-dim">
      <p className="font-medium text-ink">Starting point from your financial data</p>
      <p className="mt-1">{dateLabel(baseline.asOfDate) ? `Cash as of ${dateLabel(baseline.asOfDate)} · ` : ""}Monthly averages based on {baseline.monthsUsed} complete {baseline.monthsUsed === 1 ? "month" : "months"} · {currency}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <p><span className="block text-[10px] uppercase tracking-[0.08em]">Available cash</span><strong className="font-medium text-ink">{money(baseline.availableCash!,currency)}</strong></p>
        <p><span className="block text-[10px] uppercase tracking-[0.08em]">Monthly cash from customers</span><strong className="font-medium text-ink">{money(baseline.monthlyCashCollected!,currency)}</strong></p>
        <p><span className="block text-[10px] uppercase tracking-[0.08em]">Monthly operating spending</span><strong className="font-medium text-ink">{money(baseline.monthlyOperatingCashPaid!,currency)}</strong></p>
      </div>
      {(baseline.freshness === "stale" || baseline.freshness === "historical") && <p className="mt-1 text-warning">Your saved data may be out of date. Update it before relying on this scenario.</p>}
    </div>
    <form onSubmit={submit} noValidate>
      <fieldset><legend className="mb-3 text-sm font-medium text-ink">Enter the monthly amounts you want to test</legend>
        <p className="mb-3 text-xs text-dim">Leave a field blank to keep its current value.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="scenario-collections" className={labelClass}>Expected monthly cash from customers</label><input id="scenario-collections" className={inputClass} type="number" min="0" step="any" placeholder={`Current: ${money(baseline.monthlyCashCollected!,currency)}`} value={expectedCollections} onChange={e=>setExpectedCollections(e.target.value)} /></div>
          <div><label htmlFor="scenario-spending" className={labelClass}>Expected monthly operating spending</label><input id="scenario-spending" className={inputClass} type="number" min="0" step="any" placeholder={`Current: ${money(baseline.monthlyOperatingCashPaid!,currency)}`} value={expectedSpending} onChange={e=>setExpectedSpending(e.target.value)} /></div>
        </div>
      </fieldset>
      <fieldset className="mt-4"><legend className="mb-3 text-sm font-medium text-ink">Add a one-time cash event (optional)</legend>
        <p className="mb-3 text-xs text-dim">This changes available cash once. It does not change monthly collections or spending.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="scenario-event-type" className={labelClass}>Cash event</label><select id="scenario-event-type" className={inputClass} value={eventType} onChange={e=>setEventType(e.target.value as EventType)}><option value="none">None</option><option value="receipt">Cash coming in</option><option value="payment">Cash going out</option></select></div>
          <div><label htmlFor="scenario-event-amount" className={labelClass}>Event amount</label><input id="scenario-event-amount" className={inputClass} type="number" min="0" step="any" disabled={eventType === "none"} placeholder="0" value={eventAmount} onChange={e=>setEventAmount(e.target.value)} /></div>
        </div>
      </fieldset>
      {validationError && <p role="alert" className="mt-3 text-xs text-danger">{validationError}</p>}{actions}
    </form>
    {proposed && <ComparisonTable current={current} proposed={proposed} currency={currency} />}
  </> : <>
    <div className="mb-4 rounded-md border border-line bg-bg px-3 py-2 text-xs leading-relaxed text-dim">
      <p className="font-medium text-ink">{hasData ? "A reliable baseline is not available" : "No saved financial baseline yet"}</p>
      <p className="mt-1">Enter a manual starting point below, or update your financial data to use saved values automatically.</p>
    </div>
    <form onSubmit={submit} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label htmlFor="mc-cash" className={labelClass}>Available cash</label><input id="mc-cash" className={inputClass} type="number" min="0" step="any" value={manualCash} onChange={e=>setManualCash(e.target.value)} /></div>
        <div><label htmlFor="mc-collected" className={labelClass}>Monthly customer collections</label><input id="mc-collected" className={inputClass} type="number" min="0" step="any" value={manualCollected} onChange={e=>setManualCollected(e.target.value)} /></div>
        <div><label htmlFor="mc-paid" className={labelClass}>Monthly operating spending</label><input id="mc-paid" className={inputClass} type="number" min="0" step="any" value={manualPaid} onChange={e=>setManualPaid(e.target.value)} /></div>
      </div>
      {validationError && <p role="alert" className="mt-3 text-xs text-danger">{validationError}</p>}{actions}
    </form>
    {proposed && <ComparisonTable current={proposed} proposed={proposed} currency={currency} />}
  </>;

  if (bare) return <div>{body}</div>;
  return <section className="max-w-3xl rounded-lg border border-line bg-surface p-6 shadow-sm">
    <h2 className="text-base font-medium text-ink">What-If Scenario</h2>
    <p className="mb-5 mt-1 text-sm text-dim">Test a change without altering your saved financial data.</p>{body}
  </section>;
}
