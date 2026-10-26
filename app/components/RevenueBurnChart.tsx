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

function tableAmount(value:number|null) {
  return value === null ? "Not provided" : dollars.format(value);
}

function tableDifference(value:number|null) {
  if (value === null) return "Not available";
  if (value === 0) return dollars.format(0);
  return `${value > 0 ? "+" : "−"}${dollars.format(Math.abs(value))}`;
}

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
          strokeWidth={2} strokeDasharray="6 4" dot={{r:3,fill:"var(--surface)",stroke:"var(--danger)",strokeWidth:2}} activeDot={{r:4}} />
      </LineChart>
    </ResponsiveContainer>
    <div className="mt-3 flex justify-center gap-6 text-xs" style={{color:"var(--dim)"}} aria-label="Chart legend">
      <span className="flex items-center gap-1.5"><svg aria-hidden width="22" height="8"><line x1="1" y1="4" x2="21" y2="4" stroke="var(--teal)" strokeWidth="2" /><circle cx="11" cy="4" r="3" fill="var(--teal)" /></svg>Cash collected</span>
      <span className="flex items-center gap-1.5"><svg aria-hidden width="22" height="8"><line x1="1" y1="4" x2="21" y2="4" stroke="var(--danger)" strokeWidth="2" strokeDasharray="5 3" /><circle cx="11" cy="4" r="3" fill="var(--surface)" stroke="var(--danger)" strokeWidth="2" /></svg>Cash paid</span>
    </div>
    <details className="mt-4 border-t pt-3 text-xs" style={{borderColor:"var(--line)"}}>
      <summary className="w-fit cursor-pointer font-medium" style={{color:"var(--teal)"}}>View chart data</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <caption className="sr-only">Monthly cash collected and cash paid values shown in the chart</caption>
          <thead><tr style={{borderBottom:"1px solid var(--line)"}}>
            {['Period','Cash collected','Cash paid','Difference'].map(label=><th key={label} scope="col" className="px-3 py-2 font-medium" style={{color:"var(--dim)"}}>{label}</th>)}
          </tr></thead>
          <tbody>{points.map(point=>{
            const startLabel = financialMonthLabel(point.monthDate);
            const endLabel = point.missingThrough ? financialMonthLabel(point.missingThrough) : null;
            const period = endLabel && endLabel !== startLabel ? `${startLabel}–${endLabel}` : startLabel;
            return <tr key={`${point.monthDate}-${point.missingThrough ?? "recorded"}`} style={{borderBottom:"1px solid var(--line)"}}>
              <th scope="row" className="px-3 py-2.5 font-medium" style={{color:"var(--ink)"}}>{period}{point.missingThrough ? " (missing)" : ""}</th>
              <td className="px-3 py-2.5" style={{color:"var(--dim)"}}>{tableAmount(point.revenue)}</td>
              <td className="px-3 py-2.5" style={{color:"var(--dim)"}}>{tableAmount(point.expenses)}</td>
              <td className="px-3 py-2.5" style={{color:"var(--dim)"}}>{tableDifference(point.difference)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </details>
  </section>;
}
