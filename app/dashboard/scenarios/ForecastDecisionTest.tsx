"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { calculateCashForecast } from "@/lib/cashForecast";
import {
  applyWeeklyPlanDecision,
  validWeeklyPlanDecision,
  type ForecastDecisionContext,
  type WeeklyPlanDecision,
} from "@/lib/cashPlanDecision";
import { FORECAST_FRESHNESS_POLICY, todayIso } from "@/lib/forecastWorkflow";
import type { ActionInsert } from "@/lib/types";

const inputClass = "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-teal";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }) : "Not projected";
}

export default function ForecastDecisionTest({ context, suggestedItemId, onCreateAction }: {
  context: ForecastDecisionContext;
  suggestedItemId?: string;
  onCreateAction: (prefill: Partial<ActionInsert>) => void;
}) {
  const editable = context.items.filter((item) => item.status === "expected" || item.status === "confirmed");
  const suggested = editable.find((item) => item.id === suggestedItemId)
    ?? editable.find((item) => item.direction === "outflow") ?? editable[0];
  const [type, setType] = useState<WeeklyPlanDecision["type"]>(suggested ? "change_item" : "add_receipt");
  const [itemId, setItemId] = useState(suggested?.id ?? "");
  const [amount, setAmount] = useState(suggested?.amount == null ? "" : String(suggested.amount));
  const [expectedDate, setExpectedDate] = useState(suggested?.expectedDate ?? context.startDate);
  const [description, setDescription] = useState("Additional cash receipt");
  const [result, setResult] = useState<ReturnType<typeof calculateCashForecast> | null>(null);
  const [testedDecision, setTestedDecision] = useState<WeeklyPlanDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = useMemo(() => calculateCashForecast({
    startDate: context.startDate,
    asOfDate: context.asOfDate,
    evaluationDate: todayIso(),
    startingAvailableCash: context.startingCash,
    minimumReserve: context.minimumReserve,
    reportingCurrency: context.currency,
    items: context.items,
    freshnessPolicy: FORECAST_FRESHNESS_POLICY,
  }), [context]);

  function invalidateResult() {
    setResult(null);
    setTestedDecision(null);
    setError(null);
  }

  function chooseItem(id: string) {
    setItemId(id);
    const item = editable.find((candidate) => candidate.id === id);
    setAmount(item?.amount == null ? "" : String(item.amount));
    setExpectedDate(item?.expectedDate ?? context.startDate);
    invalidateResult();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const decision: WeeklyPlanDecision = type === "change_item"
      ? { type, itemId, amount: Number(amount), expectedDate }
      : { type, description, amount: Number(amount), expectedDate };
    if (amount.trim() === "" || !validWeeklyPlanDecision(decision, context.items)) {
      setError("Enter a valid amount, date, and cash item.");
      setResult(null);
      setTestedDecision(null);
      return;
    }
    const nextResult = calculateCashForecast({
      startDate: context.startDate,
      asOfDate: context.asOfDate,
      evaluationDate: todayIso(),
      startingAvailableCash: context.startingCash,
      minimumReserve: context.minimumReserve,
      reportingCurrency: context.currency,
      items: applyWeeklyPlanDecision(context.items, decision),
      freshnessPolicy: FORECAST_FRESHNESS_POLICY,
    });
    if (!nextResult.valid) {
      setError("This change falls outside the valid weekly plan. Check the amount and date.");
      setResult(null);
      setTestedDecision(null);
      return;
    }
    setResult(nextResult);
    setTestedDecision(decision);
    setError(null);
  }

  const improvement = result && baseline.summary.lowestProjectedCash !== null
    && result.summary.lowestProjectedCash !== null
    ? result.summary.lowestProjectedCash - baseline.summary.lowestProjectedCash : null;
  const testedItem = testedDecision?.type === "change_item"
    ? context.items.find((item) => item.id === testedDecision.itemId) : null;
  const actionName = testedDecision?.type === "change_item"
    ? `Update ${testedItem?.description ?? "planned cash item"}`
    : `Plan ${testedDecision?.description ?? "cash receipt"}`;
  const decisionDescription = testedDecision?.type === "change_item"
    ? `Change ${testedItem?.description ?? "the planned cash item"} to ${money(testedDecision.amount, context.currency)} on ${dateLabel(testedDecision.expectedDate)}.`
    : testedDecision
      ? `Plan ${testedDecision.description} of ${money(testedDecision.amount, context.currency)} on ${dateLabel(testedDecision.expectedDate)}.` : "";

  return <>
    <div className="rounded-md border border-teal/30 bg-teal/5 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-dim">Testing a published weekly plan</p>
      <p className="mt-1 text-sm text-ink">This creates a temporary copy of your plan. The published version and financial data will not change.</p>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <p><span className="block text-dim">Starting cash</span><strong>{money(context.startingCash, context.currency)}</strong></p>
        <p><span className="block text-dim">Current low point</span><strong>{baseline.summary.lowestProjectedCash === null ? "Needs review" : money(baseline.summary.lowestProjectedCash, context.currency)}</strong></p>
        <p><span className="block text-dim">Reserve</span><strong>{money(context.minimumReserve, context.currency)}</strong></p>
      </div>
    </div>

    <form onSubmit={submit} className="mt-5">
      <fieldset>
        <legend className="text-sm font-medium text-ink">What change do you want to test?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {editable.length > 0 && <button type="button" aria-pressed={type === "change_item"} onClick={() => { setType("change_item"); chooseItem(itemId || editable[0].id); }} className={`rounded-md border p-3 text-left text-sm ${type === "change_item" ? "border-teal bg-teal/5" : "border-line"}`}>Change a planned amount or date</button>}
          <button type="button" aria-pressed={type === "add_receipt"} onClick={() => { setType("add_receipt"); setAmount(""); setExpectedDate(context.startDate); invalidateResult(); }} className={`rounded-md border p-3 text-left text-sm ${type === "add_receipt" ? "border-teal bg-teal/5" : "border-line"}`}>Add one-time cash coming in</button>
        </div>
      </fieldset>

      {type === "change_item" ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-dim">Planned cash item<select className={inputClass} value={itemId} onChange={(event) => chooseItem(event.target.value)}>{editable.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select></label>
        <label className="text-xs text-dim">Test amount<input className={inputClass} type="number" min="0" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); invalidateResult(); }} /></label>
        <label className="text-xs text-dim">Test date<input className={inputClass} type="date" value={expectedDate} onChange={(event) => { setExpectedDate(event.target.value); invalidateResult(); }} /></label>
      </div> : <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-dim">Description<input className={inputClass} value={description} onChange={(event) => { setDescription(event.target.value); invalidateResult(); }} /></label>
        <label className="text-xs text-dim">Amount<input className={inputClass} type="number" min="0" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); invalidateResult(); }} /></label>
        <label className="text-xs text-dim">Expected date<input className={inputClass} type="date" value={expectedDate} onChange={(event) => { setExpectedDate(event.target.value); invalidateResult(); }} /></label>
      </div>}

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <button className="mt-4 rounded-md bg-teal px-4 py-2 text-sm font-medium text-white">See weekly impact</button>
    </form>

    {result && testedDecision && <section className="mt-5 rounded-md border border-line bg-bg p-4">
      <h2 className="text-base font-medium text-ink">How this change affects the plan</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <p className="text-sm"><span className="block text-xs text-dim">Lowest cash</span><strong>{result.summary.lowestProjectedCash === null ? "Needs review" : money(result.summary.lowestProjectedCash, context.currency)}</strong>{improvement !== null && <span className="block text-xs text-dim">{improvement >= 0 ? `${money(improvement, context.currency)} better` : `${money(Math.abs(improvement), context.currency)} worse`}</span>}</p>
        <p className="text-sm"><span className="block text-xs text-dim">First reserve warning</span><strong>{dateLabel(result.summary.firstReserveBreachWeek)}</strong></p>
        <p className="text-sm"><span className="block text-xs text-dim">Ending cash</span><strong>{result.summary.endingCash === null ? "Needs review" : money(result.summary.endingCash, context.currency)}</strong></p>
      </div>
      <p className="mt-4 text-sm text-ink">{result.summary.firstReserveBreachWeek === null ? "This change keeps projected cash at or above your protected reserve." : `Cash would still fall below your reserve during the week of ${dateLabel(result.summary.firstReserveBreachWeek)}.`}</p>
      <button type="button" onClick={() => onCreateAction({
        name: actionName,
        goal_type: "risk_mitigation",
        description: `${decisionDescription} Projected lowest cash becomes ${result.summary.lowestProjectedCash === null ? "unavailable" : money(result.summary.lowestProjectedCash, context.currency)}.`,
        linked_forecast_version_id: context.versionId,
      })} className="mt-4 rounded-md border border-teal px-3 py-2 text-sm font-medium text-teal">Create action from this change</button>
    </section>}

    <p className="mt-5 text-xs text-dim">Want to test monthly collections or recurring spending instead? <Link href="/dashboard/scenarios" className="text-teal underline">Open the monthly decision test</Link>.</p>
  </>;
}
