import { normalizedCashHealth } from "./normalizedCashHealth";
import type { FinancialMonth } from "./types";

export type ContextCapability =
  | "historical_cash_guidance"
  | "current_cash_guidance"
  | "ai_insights"
  | "thirteen_week_forecast"
  | "forecast_case_comparison";

export type CapabilityReadiness = {
  status: "ready" | "limited" | "enrichment_needed" | "unavailable";
  supportedUses: string[];
  missingInputs: string[];
};

export type FinancialContextReadiness = {
  contextLevel: "none" | "monthly_history" | "monthly_with_liquidity" | "weekly_forecast" | "forecast_cases";
  sourcePeriods: { start: string | null; end: string | null; monthsUsed: number };
  dataVersion: 1 | 2 | null;
  freshness: "current" | "stale" | "historical" | "unavailable";
  capabilities: Record<ContextCapability, CapabilityReadiness>;
};

export type ReadinessInput = {
  months: FinancialMonth[];
  evaluationDate: string;
  currentDataMaxAgeDays: number;
  liquidityDetailAvailable: boolean;
  forecast: null | {
    ready: boolean;
    hasPublishedCases: boolean;
    missingInputs: string[];
  };
};

const DAY_MS = 86_400_000;

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function unavailable(missingInputs: string[]): CapabilityReadiness {
  return { status: "unavailable", supportedUses: [], missingInputs };
}

export function assessFinancialContextReadiness(input: ReadinessInput): FinancialContextReadiness {
  const health = normalizedCashHealth(input.months);
  const latest = [...input.months].sort((a, b) => b.month_date.localeCompare(a.month_date))[0] ?? null;
  const evaluation = dateValue(input.evaluationDate);
  const cashDate = health.cash.asOfDate ? dateValue(health.cash.asOfDate) : null;
  const age = evaluation === null || cashDate === null ? null : Math.floor((evaluation - cashDate) / DAY_MS);
  const hasMonthlyHistory = health.window.monthsUsed > 0;
  const isCurrent = age !== null && age >= 0 && age <= input.currentDataMaxAgeDays;
  const forecastReady = input.forecast?.ready === true;
  const casesReady = forecastReady && input.forecast?.hasPublishedCases === true;

  let contextLevel: FinancialContextReadiness["contextLevel"] = "none";
  if (hasMonthlyHistory) contextLevel = input.liquidityDetailAvailable
    ? "monthly_with_liquidity" : "monthly_history";
  if (forecastReady) contextLevel = casesReady ? "forecast_cases" : "weekly_forecast";

  const historical = hasMonthlyHistory ? {
    status: "ready" as const,
    supportedUses: ["cash health", "operating trends", "cash buffer and runway", "bounded monthly scenarios"],
    missingInputs: [],
  } : unavailable(["at least one reconciled contract-v2 financial month"]);

  const current = !hasMonthlyHistory ? unavailable(["current reconciled financial data"])
    : isCurrent ? {
      status: "ready" as const,
      supportedUses: ["current available cash", "current operating cash guidance"],
      missingInputs: [],
    } : {
      status: "limited" as const,
      supportedUses: ["historical context"],
      missingInputs: ["updated current cash data"],
    };

  const insights = !hasMonthlyHistory ? unavailable(["reconciled contract-v2 financial history"])
    : {
      status: isCurrent ? "ready" as const : "limited" as const,
      supportedUses: health.window.monthsUsed >= 2
        ? ["data-quality findings", "cash-health findings", "month-over-month operating patterns"]
        : ["data-quality findings", "single-period cash-health findings"],
      missingInputs: [
        ...(health.window.monthsUsed < 2 ? ["a second consecutive complete month for trend findings"] : []),
        ...(!isCurrent ? ["updated current cash data for current-state findings"] : []),
      ],
    };

  const forecastMissing = input.forecast?.missingInputs.length
    ? input.forecast.missingInputs
    : ["starting available cash", "dated expected receipts", "dated expected payments"];
  const forecast = forecastReady ? {
    status: "ready" as const,
    supportedUses: ["13-week cash projection", "minimum-reserve risk", "weekly cash timing"],
    missingInputs: [],
  } : {
    status: "enrichment_needed" as const,
    supportedUses: hasMonthlyHistory ? ["historical context while forecast inputs are collected"] : [],
    missingInputs: forecastMissing,
  };

  const cases = casesReady ? {
    status: "ready" as const,
    supportedUses: ["base/downside/upside comparison", "assumption sensitivity"],
    missingInputs: [],
  } : {
    status: "enrichment_needed" as const,
    supportedUses: forecastReady ? ["base forecast analysis"] : [],
    missingInputs: forecastReady ? ["published alternative forecast cases"] : forecastMissing,
  };

  return {
    contextLevel,
    sourcePeriods: {
      start: health.window.periodStart,
      end: health.window.periodEnd,
      monthsUsed: health.window.monthsUsed,
    },
    dataVersion: latest?.data_contract_version ?? null,
    freshness: !hasMonthlyHistory ? "unavailable" : isCurrent ? "current" : age === null ? "unavailable"
      : age >= 0 ? (age <= 365 ? "stale" : "historical") : "unavailable",
    capabilities: {
      historical_cash_guidance: historical,
      current_cash_guidance: current,
      ai_insights: insights,
      thirteen_week_forecast: forecast,
      forecast_case_comparison: cases,
    },
  };
}
