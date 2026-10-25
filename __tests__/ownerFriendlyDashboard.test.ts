import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import BottomAlerts from "../app/components/BottomAlerts";
import BurnRateCard from "../app/components/BurnRateCard";
import CashOutCard from "../app/components/CashOutCard";
import CashPositionCard from "../app/components/CashPositionCard";
import RunwayCard from "../app/components/RunwayCard";
import type {FinancialMonth} from "../lib/types";

const months=[
  {month_date:"2025-12-01",total_revenue:51_200,total_expenses:44_800},
  {month_date:"2025-11-01",total_revenue:48_800,total_expenses:41_300},
  {month_date:"2025-10-01",total_revenue:46_800,total_expenses:38_300},
] as FinancialMonth[];
const render=(component:ReturnType<typeof createElement>)=>renderToStaticMarkup(component);
const alertProps={alerts:[],dismissedAlerts:[],dataVersion:null,snoozeDuration:"24h" as const};

describe("owner-friendly dashboard language",()=>{
  it("explains the four cash-health cards without internal metric names",()=>{
    const html=[
      render(createElement(CashPositionCard,{initialData:{cash:138_200,month:"2025-12-01",previousCash:131_800}})),
      render(createElement(BurnRateCard,{cash:138_200,months})),
      render(createElement(RunwayCard,{cash:138_200,months})),
      render(createElement(CashOutCard,{cash:138_200,months})),
    ].join(" ");
    expect(html).toContain("Cash Balance");
    expect(html).toContain("Cash Buffer");
    expect(html).toContain("Cash Trend");
    expect(html).toContain("More cash in than out");
    expect(html).toContain("Cash Runway");
    expect(html).toContain("Update needed");
    expect(html).not.toContain("Reported Spending Coverage");
    expect(html).not.toContain("Historical Cash Direction");
    expect(html).not.toContain("Estimated Cash Depletion");
  });

  it("does not give a historical cash balance a healthy accent",()=>{
    const historical=render(createElement(CashPositionCard,{initialData:{cash:138_200,month:"2025-12-01",previousCash:131_800},minCashReserve:10_000}));
    expect(historical).toContain("border-left:3px solid var(--line)");
    expect(historical).not.toContain("border-left:3px solid var(--success)");
  });

  it.each([
    ["current","No financial warnings detected from the information provided."],
    ["stale","No warnings detected, but your financial data may be out of date."],
    ["historical","Update your financial data to receive a current cash-health assessment."],
    ["unknown","Add financial data to receive a cash-health assessment."],
  ] as const)("uses %s empty-alert guidance",(dataFreshness,message)=>{
    const html=render(createElement(BottomAlerts,{...alertProps,dataFreshness}));
    expect(html).toContain(message);
    expect(html).not.toContain("Everything looks healthy");
  });
});
