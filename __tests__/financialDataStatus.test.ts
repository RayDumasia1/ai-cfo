import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getFinancialImportStatus } from "../lib/db";
import { financialDataCoverage } from "../lib/financialDataStatus";
import FinancialDataStatusCard from "../app/components/FinancialDataStatusCard";
import RevenueBurnChart from "../app/components/RevenueBurnChart";

const query = {select:vi.fn(),eq:vi.fn(),in:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn()};
const from = vi.fn(()=>query);
const client = {from} as unknown as SupabaseClient;
beforeEach(()=>{
  vi.clearAllMocks();
  for(const name of ["select","eq","in","order","limit"] as const)query[name].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({data:{created_at:"2026-10-24T14:00:00Z"},error:null});
});

describe("account-scoped import status",()=>{
  it("reads only the latest successful source import and excludes manual clear audits",async()=>{
    expect(await getFinancialImportStatus("account-a",client)).toEqual({available:true,lastImportedAt:"2026-10-24T14:00:00Z"});
    expect(from).toHaveBeenCalledExactlyOnceWith("data_imports");
    expect(query.select).toHaveBeenCalledWith("created_at");
    expect(query.eq.mock.calls).toEqual([["user_id","account-a"],["status","success"]]);
    expect(query.in).toHaveBeenCalledWith("import_type",["excel","csv","quickbooks"]);
    expect(query.order).toHaveBeenCalledWith("created_at",{ascending:false});
    expect(query.limit).toHaveBeenCalledWith(1);
  });
  it("distinguishes no imports from an unavailable query",async()=>{
    query.maybeSingle.mockResolvedValue({data:null,error:null});
    expect(await getFinancialImportStatus("account-a",client)).toEqual({available:true,lastImportedAt:null});
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      query.maybeSingle.mockResolvedValue({data:null,error:{code:"test",message:"Private detail"}});
      expect(await getFinancialImportStatus("account-a",client)).toEqual({available:false,lastImportedAt:null});
      expect(log).toHaveBeenCalledWith("financialData:importStatus:error",{code:"test"});
    } finally {log.mockRestore();}
  });
});

describe("compact financial data status",()=>{
  it("reports internal coverage gaps without inventing a twelve-month minimum",()=>{
    expect(financialDataCoverage(["2025-04-01","2025-02-01"])).toEqual({latestMonth:"2025-04-01",missingMonths:["2025-03-01"]});
    expect(financialDataCoverage(["2025-04-01"]).missingMonths).toEqual([]);
    expect(financialDataCoverage([]).latestMonth).toBeNull();
  });
  it("distinguishes financial period from import time and links to the dedicated workflow",()=>{
    const html=renderToStaticMarkup(createElement(FinancialDataStatusCard,{months:["2025-02-01","2025-04-01"],importStatus:{available:true,lastImportedAt:"2026-10-24T14:00:00Z"}}));
    expect(html).toContain("Data through April 2025");
    expect(html).toContain("Last successful import: Oct 24, 2026");
    expect(html).toContain("March 2025");
    expect(html).toContain('href="/dashboard/financial-data"');
    expect(html).not.toContain("Choose file");
  });
  it("offers an empty state and an honest unavailable status",()=>{
    const html=renderToStaticMarkup(createElement(FinancialDataStatusCard,{months:[],importStatus:{available:false,lastImportedAt:null}}));
    expect(html).toContain("No financial data loaded yet.");
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("No successful import recorded");
  });
  it("routes chart empty-state uploads to the Financial data page",()=>{
    const html=renderToStaticMarkup(createElement(RevenueBurnChart,{months:[]}));
    expect(html).toContain('href="/dashboard/financial-data"');
    expect(html).not.toContain('href="#import"');
  });
});
