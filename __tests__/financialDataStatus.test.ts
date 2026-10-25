import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getFinancialImportStatus } from "../lib/db";
import { financialDataCoverage } from "../lib/financialDataStatus";
import FinancialDataStatusCard from "../app/components/FinancialDataStatusCard";
import FinancialDataProvenanceCard from "../app/components/FinancialDataProvenanceCard";
import RevenueBurnChart from "../app/components/RevenueBurnChart";

const query = {select:vi.fn(),eq:vi.fn(),in:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn()};
const from = vi.fn(()=>query);
const client = {from} as unknown as SupabaseClient;
beforeEach(()=>{
  vi.clearAllMocks();
  for(const name of ["select","eq","in","order","limit"] as const)query[name].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({data:{created_at:"2026-10-24T14:00:00Z",import_type:"excel",filename:"cash-data.xlsx",months_imported:12},error:null});
});

describe("account-scoped import status",()=>{
  it("reads only the latest successful source import and excludes manual clear audits",async()=>{
    expect(await getFinancialImportStatus("account-a",client)).toEqual({available:true,lastImportedAt:"2026-10-24T14:00:00Z",filename:"cash-data.xlsx"});
    expect(from).toHaveBeenCalledExactlyOnceWith("data_imports");
    expect(query.select).toHaveBeenCalledWith("created_at,filename");
    expect(query.eq.mock.calls).toEqual([["user_id","account-a"],["status","success"]]);
    expect(query.in).toHaveBeenCalledWith("import_type",["excel","csv","quickbooks"]);
    expect(query.order).toHaveBeenCalledWith("created_at",{ascending:false});
    expect(query.limit).toHaveBeenCalledWith(1);
  });
  it("distinguishes no imports from an unavailable query",async()=>{
    query.maybeSingle.mockResolvedValue({data:null,error:null});
    expect(await getFinancialImportStatus("account-a",client)).toEqual({available:true,lastImportedAt:null,filename:null});
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      query.maybeSingle.mockResolvedValue({data:null,error:{code:"test",message:"Private detail"}});
      expect(await getFinancialImportStatus("account-a",client)).toEqual({available:false,lastImportedAt:null,filename:null});
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
    const html=renderToStaticMarkup(createElement(FinancialDataStatusCard,{months:["2025-02-01","2025-04-01"],importStatus:{available:true,lastImportedAt:"2026-10-24T14:00:00Z",filename:"cash-data.xlsx"}}));
    expect(html).toContain("Data through April 2025");
    expect(html).toContain("Last successful import: Oct 24, 2026");
    expect(html).toContain("March 2025");
    expect(html).toContain('href="/dashboard/financial-data"');
    expect(html).not.toContain("Choose file");
  });
  it("offers an empty state and an honest unavailable status",()=>{
    const html=renderToStaticMarkup(createElement(FinancialDataStatusCard,{months:[],importStatus:{available:false,lastImportedAt:null,filename:null}}));
    expect(html).toContain("No financial data loaded yet.");
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("No successful import recorded");
  });
  it("routes chart empty-state uploads to the Financial data page",()=>{
    const html=renderToStaticMarkup(createElement(RevenueBurnChart,{months:[]}));
    expect(html).toContain('href="/dashboard/financial-data"');
    expect(html).not.toContain('href="#import"');
  });

  it("shows account data provenance without treating the import time as the reporting period",()=>{
    const months = [
      {month_date:"2026-08-01",data_contract_version:2 as const,source_type:"spreadsheet" as const,accounting_basis:"cash" as const,reporting_currency:"USD",period_status:"complete" as const,period_cutoff_date:null},
      {month_date:"2026-09-01",data_contract_version:2 as const,source_type:"spreadsheet" as const,accounting_basis:"cash" as const,reporting_currency:"USD",period_status:"partial" as const,period_cutoff_date:"2026-09-20"},
    ];
    const html=renderToStaticMarkup(createElement(FinancialDataProvenanceCard,{months,importStatus:{available:true,lastImportedAt:"2026-10-24T14:00:00Z",filename:"<cash-data>.xlsx"}}));
    expect(html).toContain("About your financial data");
    expect(html).toContain("Elidan spreadsheet");
    expect(html).toContain("August 2026 – September 2026 · 2 stored months");
    expect(html).toContain("Partial through Sep 20, 2026");
    expect(html).toContain("Cash basis");
    expect(html).toContain("Elidan cash model v2");
    expect(html).toContain("&lt;cash-data&gt;.xlsx");
    expect(html).not.toContain("<cash-data>.xlsx");
  });

  it("labels mixed provenance and hides the card when no financial rows exist",()=>{
    const months = [
      {month_date:"2026-08-01",data_contract_version:1 as const,source_type:"legacy_spreadsheet" as const,accounting_basis:null,reporting_currency:null,period_status:"unknown" as const,period_cutoff_date:null},
      {month_date:"2026-09-01",data_contract_version:2 as const,source_type:"quickbooks" as const,accounting_basis:"accrual" as const,reporting_currency:"USD",period_status:"complete" as const,period_cutoff_date:null},
    ];
    const importStatus={available:false,lastImportedAt:null,filename:null};
    const html=renderToStaticMarkup(createElement(FinancialDataProvenanceCard,{months,importStatus}));
    expect(html.match(/Multiple/g)?.length).toBe(2);
    expect(html).toContain("Temporarily unavailable");
    expect(renderToStaticMarkup(createElement(FinancialDataProvenanceCard,{months:[],importStatus}))).toBe("");
  });
});
