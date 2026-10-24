import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { alertEngine, currentRunway, getRevenueVsBurnChartData, monthlyBurnRate } from "../lib/calculations";
import RevenueBurnChart from "../app/components/RevenueBurnChart";
import type { BusinessProfile, FinancialMonth } from "../lib/types";

function month(date: string, expenses = 300): FinancialMonth {
  return { id: date, user_id: "synthetic-user", business_id: null, month_date: date,
    opening_cash: 1100, closing_cash: 1000, total_revenue: 200, total_expenses: expenses,
    payroll: null, ar_outstanding: null, ap_outstanding: null, notes: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
}
const year = Array.from({ length: 12 }, (_, i) => month(`2025-${String(12-i).padStart(2,"0")}-01`));

describe("twelve-month dashboard trends", () => {
  it("shows the latest twelve stored records chronologically without changing the input", () => {
    const months = [...year, month("2024-12-01",99999)];
    const result = getRevenueVsBurnChartData(months)!;
    expect(result.labels).toEqual(["Jan 2025","Feb 2025","Mar 2025","Apr 2025","May 2025","Jun 2025",
      "Jul 2025","Aug 2025","Sep 2025","Oct 2025","Nov 2025","Dec 2025"]);
    expect(result.burn).toHaveLength(12);
    expect(result.burn).not.toContain(99999);
    expect(result.missingMonths).toBe(0);
    expect(months[0].month_date).toBe("2025-12-01");
  });

  it("preserves partial history and missing values, and identifies missing calendar months", () => {
    const months = [month("2025-12-01"),{...month("2025-10-01"), total_revenue: null, total_expenses: null}];
    const result = getRevenueVsBurnChartData(months)!;
    expect(result.labels).toEqual(["Oct 2025","Dec 2025"]);
    expect(result.revenue).toEqual([null,200]);
    expect(result.burn).toEqual([null,300]);
    expect(result.missingMonths).toBe(1);
    expect(getRevenueVsBurnChartData([])).toBeNull();
    expect(getRevenueVsBurnChartData([month("2025-12-01")])?.missingMonths).toBe(0);
  });

  it("leaves three-month burn, runway, and alerts unchanged when older records are displayed", () => {
    const recent = [month("2025-12-01",300),month("2025-11-01",200),month("2025-10-01",100),...year.slice(3,6)];
    const expanded = [...recent,...year.slice(6).map(m => ({...m,total_expenses:99999,closing_cash:0}))];
    const expenses = (months: FinancialMonth[]) => months.map(m => m.total_expenses);
    expect(monthlyBurnRate(expenses(expanded))).toBe(200);
    expect(currentRunway(1000,expenses(expanded))).toBe(5);
    expect(currentRunway(1000,expenses(expanded))).toBe(currentRunway(1000,expenses(recent)));
    const profile = { min_cash_reserve: 1500, runway_warning_threshold: 6,
      runway_danger_threshold: 3, burn_rate_warning_pct: 0.2 } as BusinessProfile;
    expect(alertEngine(expanded,profile)).toEqual(alertEngine(recent,profile));
  });

  it("labels historical dates and missing months rather than implying data is from today", () => {
    const markup = renderToStaticMarkup(createElement(RevenueBurnChart,{
      months:[month("2025-12-01"),month("2025-10-01")],
    }));
    expect(markup).toContain("Oct 2025 – Dec 2025");
    expect(markup).toContain("2");
    expect(markup).toContain("stored");
    expect(markup).toContain("1 missing month; gaps break the lines");
    expect(markup).not.toContain("Last 2 months");
  });
});
