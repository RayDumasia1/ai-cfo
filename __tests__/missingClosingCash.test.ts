import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getCurrentCashPosition } from "../lib/db";
import { currentRunway } from "../lib/calculations";
import type { FinancialMonth } from "../lib/types";
import CashPositionCard from "../app/components/CashPositionCard";
import RunwayCard from "../app/components/RunwayCard";
import CashOutCard from "../app/components/CashOutCard";

const query={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn()};
const from=vi.fn(()=>query);
const client={from} as unknown as SupabaseClient;
const month = {month_date:"2025-12-01",closing_cash:null,total_expenses:100} as FinancialMonth;
const text = (html:string)=>html.replace(/<!--.*?-->/g,"");
beforeEach(()=>{
  vi.clearAllMocks();
  for(const name of ["select","eq","order"] as const)query[name].mockReturnValue(query);
  query.limit.mockResolvedValue({data:[{month_date:"2025-12-01",closing_cash:null},{month_date:"2025-11-01",closing_cash:900}],error:null});
});

describe("missing closing cash is unknown, not zero",()=>{
  it("preserves the latest blank instead of zero or an older balance",async()=>{
    const cash=await getCurrentCashPosition("own-account",client);
    expect(cash).toEqual({cash:null,month:"2025-12-01",previousCash:900});
    expect(query.eq).toHaveBeenCalledWith("user_id","own-account");
    expect(query.order).toHaveBeenCalledWith("month_date",{ascending:false});
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(currentRunway(cash!.cash,[100])).toBeNull();
  });
  it("shows an explicit cash empty state without a false comparison or reserve result",()=>{
    const html=renderToStaticMarkup(createElement(CashPositionCard,{initialData:{cash:null,month:"2025-12-01",previousCash:900},minCashReserve:1000}));
    expect(html).toContain("Closing cash missing for December 2025");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("vs last month");
    expect(html).not.toContain("var(--danger)");
  });
  it.each([100,0,null])("does not call unknown cash stable when expenses are %s",expenses=>{
    const months=[{...month,total_expenses:expenses}];
    const runway=renderToStaticMarkup(createElement(RunwayCard,{cash:null,months}));
    const cashOut=renderToStaticMarkup(createElement(CashOutCard,{cash:null,months}));
    for(const html of [runway,cashOut]) {
      expect(html).toContain("Latest month is missing closing cash");
      expect(html).not.toContain("Stable");
      expect(html).not.toContain("Not burning cash");
      expect(html).not.toContain("No data imported yet");
    }
  });
  it("keeps real zero cash meaningful",async()=>{
    query.limit.mockResolvedValue({data:[{month_date:"2025-12-01",closing_cash:0}],error:null});
    expect((await getCurrentCashPosition("own-account",client))?.cash).toBe(0);
    const cash=renderToStaticMarkup(createElement(CashPositionCard,{initialData:{cash:0,month:"2025-12-01",previousCash:null}}));
    expect(cash).toContain("$0");
    expect(text(renderToStaticMarkup(createElement(RunwayCard,{cash:0,months:[month]})))).toContain("0.0 months");
    expect(renderToStaticMarkup(createElement(CashOutCard,{cash:0,months:[month]}))).not.toContain("missing closing cash");
  });
  it("keeps known positive cash calculations and comparisons",()=>{
    const cash=renderToStaticMarkup(createElement(CashPositionCard,{initialData:{cash:900,month:"2025-12-01",previousCash:800}}));
    expect(cash).toContain("$900");
    expect(cash).toContain("+$100 vs last month");
    expect(text(renderToStaticMarkup(createElement(RunwayCard,{cash:900,months:[month]})))).toContain("9.0 months");
    expect(renderToStaticMarkup(createElement(CashOutCard,{cash:900,months:[month]}))).toContain("Based on $100/mo avg burn");
  });
  it("preserves the no-records state",async()=>{
    query.limit.mockResolvedValue({data:[],error:null});
    expect(await getCurrentCashPosition("own-account",client)).toBeNull();
    expect(renderToStaticMarkup(createElement(CashPositionCard,{initialData:null}))).toContain("No data imported yet");
  });
});
