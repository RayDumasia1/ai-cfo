"use client";

import { useId } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { BarChart2 } from "lucide-react";
import Link from "next/link";
import { financialChartMonthLabel, getRevenueVsBurnChartData } from "@/lib/calculations";
import type { FinancialMonth } from "@/lib/types";
import { financialMonthLabel } from "@/lib/financialDataStatus";
import RevenueExpensesTooltip from "./RevenueExpensesTooltip";

interface RevenueBurnChartProps { months: FinancialMonth[]; }

const dollars = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:2});
const axisDollars = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1});

const CARD_STYLE: React.CSSProperties = {
  background:"var(--surface)",border:"1px solid var(--line)",borderRadius:"var(--radius-lg)",
  boxShadow:"var(--shadow-sm)",padding:24,minHeight:316,
};

export default function RevenueBurnChart({months}:RevenueBurnChartProps) {
  const titleId = useId();
  const descriptionId = useId();
  const chart = getRevenueVsBurnChartData(months);
  if (!chart) return <section aria-labelledby={titleId} style={CARD_STYLE}>
    <h2 id={titleId} className="text-sm font-medium" style={{color:"var(--ink)"}}>Cash Collected vs Cash Paid · No data yet</h2>
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 pt-4">
      <BarChart2 aria-hidden size={32} style={{color:"var(--line)"}} strokeWidth={1.5} />
      <p className="max-w-72 text-center text-sm" style={{color:"var(--dim)"}}>Upload your financial data to see reported cash collected and cash paid.</p>
      <Link href="/dashboard/financial-data" className="text-sm underline" style={{color:"var(--teal)"}}>Upload data</Link>
    </div>
  </section>;

  const {labels,points,ticks,missingMonths} = chart;
  const storedCount = labels.length;
  const first = points[0];
  const latest = points[points.length-1];
  const latestLabel = financialMonthLabel(latest.monthDate);
  const periodLabel = storedCount === 1 ? labels[0] : `${labels[0]} – ${labels[storedCount-1]}`;
  let insight: string;
  if (latest.difference === null) {
    const missing = latest.revenue === null && latest.expenses === null ? "Cash collected and cash paid were"
      : latest.revenue === null ? "Cash collected was" : "Cash paid was";
    insight = `${missing} not provided for ${latestLabel}; comparison unavailable.`;
  } else if (latest.difference === 0) insight = `${latestLabel} cash collected equaled cash paid.`;
  else insight = latest.difference > 0
    ? `${latestLabel} cash collected exceeded cash paid by ${dollars.format(latest.difference)}.`
    : `${latestLabel} cash paid exceeded cash collected by ${dollars.format(Math.abs(latest.difference))}.`;

  return <section aria-labelledby={titleId} aria-describedby={descriptionId} style={CARD_STYLE}>
    <div className="mb-4 space-y-1">
      <h2 id={titleId} className="text-sm font-medium" style={{color:"var(--ink)"}}>Cash Collected vs Cash Paid · {periodLabel}</h2>
      <p id={descriptionId} className="text-xs" style={{color:"var(--dim)"}}>
        {storedCount} stored {storedCount === 1 ? "month" : "months"} · Monthly totals in USD
        {missingMonths > 0 && ` · ${missingMonths} missing ${missingMonths === 1 ? "month" : "months"}; gaps break the lines`}
      </p>
      <p className="text-xs" style={{color:"var(--ink)"}}>{insight}</p>
    </div>
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={points} margin={{top:4,right:12,left:0,bottom:0}} accessibilityLayer>
        <CartesianGrid horizontal vertical={false} stroke="var(--line)" strokeOpacity={0.4} />
        <XAxis dataKey="monthIndex" type="number" scale="linear"
          domain={first.monthIndex === latest.monthIndex ? [first.monthIndex-1,latest.monthIndex+1] : [first.monthIndex,latest.monthIndex]}
          ticks={ticks} tickFormatter={financialChartMonthLabel} interval="preserveStartEnd" minTickGap={24}
          axisLine={false} tickLine={false} tick={{fontSize:11,fill:"var(--dim)"}} />
        <YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:"var(--dim)"}}
          tickFormatter={value=>axisDollars.format(value)} width={56} />
        <Tooltip filterNull={false} content={({active,label})=><RevenueExpensesTooltip active={active}
          point={points.find(point=>point.monthIndex === Number(label))} />} />
        <Line type="linear" dataKey="revenue" name="Cash collected" connectNulls={false} stroke="var(--teal)"
          strokeWidth={2} dot={{r:3,fill:"var(--teal)",strokeWidth:0}} activeDot={{r:4}} />
        <Line type="linear" dataKey="expenses" name="Cash paid" connectNulls={false} stroke="var(--danger)"
          strokeWidth={2} dot={{r:3,fill:"var(--danger)",strokeWidth:0}} activeDot={{r:4}} />
      </LineChart>
    </ResponsiveContainer>
    <div className="mt-3 flex justify-center gap-6 text-xs" style={{color:"var(--dim)"}} aria-label="Chart legend">
      <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{background:"var(--teal)"}} />Cash collected</span>
      <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{background:"var(--danger)"}} />Cash paid</span>
    </div>
  </section>;
}
