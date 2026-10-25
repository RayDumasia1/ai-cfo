import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("../lib/supabase",()=>({supabase:{}}));
import { getFinancialImportStatus, getRecentFinancialImports } from "../lib/db";
import { financialDataCoverage } from "../lib/financialDataStatus";
import FinancialDataStatusCard from "../app/components/FinancialDataStatusCard";
import FinancialDataProvenanceCard from "../app/components/FinancialDataProvenanceCard";
import FinancialDataOverviewCard from "../app/components/FinancialDataOverviewCard";
import RecentFinancialImportsCard from "../app/components/RecentFinancialImportsCard";
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

  it("reads a bounded account-scoped history without selecting stored error messages",async()=>{
    const imports=[{id:"import-1",import_type:"excel",filename:"cash.xlsx",months_imported:12,status:"success",created_at:"2026-10-24T14:00:00Z"}];
    const historyQuery={select:vi.fn(),eq:vi.fn(),in:vi.fn(),order:vi.fn(),limit:vi.fn()};
    for(const name of ["select","eq","in","order"] as const)historyQuery[name].mockReturnValue(historyQuery);
    historyQuery.limit.mockResolvedValue({data:imports,error:null});
    const historyFrom=vi.fn(()=>historyQuery);
    const historyClient={from:historyFrom} as unknown as SupabaseClient;

    expect(await getRecentFinancialImports("account-a",5,historyClient)).toEqual({available:true,imports});
    expect(historyFrom).toHaveBeenCalledExactlyOnceWith("data_imports");
    expect(historyQuery.select).toHaveBeenCalledWith("id,import_type,filename,months_imported,status,created_at");
    expect(historyQuery.eq).toHaveBeenCalledWith("user_id","account-a");
    expect(historyQuery.in).toHaveBeenCalledWith("import_type",["excel","csv","quickbooks"]);
    expect(historyQuery.order).toHaveBeenCalledWith("created_at",{ascending:false});
    expect(historyQuery.limit).toHaveBeenCalledWith(5);
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
    const overview=renderToStaticMarkup(createElement(FinancialDataOverviewCard,{months}));
    expect(overview).toContain("Current financial data");
    expect(overview).toContain("August 2026 – September 2026 · 2 months");
    expect(overview).toContain("Partial through Sep 20, 2026");
    expect(overview).toContain("Cash basis · USD");
    const details=renderToStaticMarkup(createElement(FinancialDataProvenanceCard,{months,importStatus:{available:true,lastImportedAt:"2026-10-24T14:00:00Z",filename:"<cash-data>.xlsx"}}));
    expect(details).toContain("Source details");
    expect(details).toContain("Elidan spreadsheet");
    expect(details).toContain("Elidan cash model v2");
    expect(details).toContain("&lt;cash-data&gt;.xlsx");
    expect(details).not.toContain("<cash-data>.xlsx");
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

  it("renders successful and failed import history responsively without exposing error details",()=>{
    const imports = [
      {id:"one",import_type:"excel" as const,filename:"latest.xlsx",months_imported:12,status:"success" as const,created_at:"2026-10-24T14:00:00Z"},
      {id:"two",import_type:"quickbooks" as const,filename:null,months_imported:null,status:"error" as const,created_at:"2026-10-23T14:00:00Z"},
    ];
    const html=renderToStaticMarkup(createElement(RecentFinancialImportsCard,{history:{available:true,imports}}));
    expect(html).toContain("Recent imports");
    expect(html).toContain("latest.xlsx");
    expect(html).toContain("Spreadsheet upload");
    expect(html).toContain("QuickBooks");
    expect(html).toContain("Successful");
    expect(html).toContain("Failed");
    expect(html).toContain("Uploaded files are not stored");
    expect(html).not.toContain("error_message");
  });
});
