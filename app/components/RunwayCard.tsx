"use client";

import {financialDataFreshness,legacyCashHealth} from "@/lib/calculations";
import type {FinancialMonth} from "@/lib/types";
import StatCard from "./StatCard";

interface RunwayCardProps { cash:number|null; months:FinancialMonth[]; isNewUser?:boolean; }
const currency=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});

/** Plain-language direction of reported cash activity. */
export default function RunwayCard({cash,months,isNewUser=false}:RunwayCardProps) {
  if (cash===null&&months.length>0) {
    return <StatCard label="Cash Trend" value="—" subtext="Latest month is missing closing cash" />;
  }
  const metric=legacyCashHealth(cash,months);
  if (metric.monthsUsed===0||metric.estimatedNetCashFlow===null) {
    return <StatCard label="Cash Trend" value="—"
      subtext={isNewUser?"Complete setup to see this":"Cash collected or paid is missing"} />;
  }
  const freshness=financialDataFreshness(metric.periodEnd);
  const suffix=freshness==="historical"?" · Update your data":freshness==="stale"?" · Data may be out of date":"";
  if (metric.estimatedNetCashFlow>0) {
    return <StatCard label="Cash Trend" value="More cash in than out"
      subtext={`${currency.format(metric.estimatedNetCashFlow)}/mo average across ${metric.monthsUsed} usable ${metric.monthsUsed===1?"month":"months"}${suffix}`} />;
  }
  if (metric.estimatedNetCashFlow===0) {
    return <StatCard label="Cash Trend" value="Cash in matched cash out"
      subtext={`${metric.monthsUsed} usable ${metric.monthsUsed===1?"month":"months"}${suffix}`} />;
  }
  return <StatCard label="Cash Trend" value="More cash out than in"
    subtext={`${currency.format(metric.estimatedNetCashBurn!)}/mo average net cash used across ${metric.monthsUsed} usable ${metric.monthsUsed===1?"month":"months"}${suffix}`} />;
}
