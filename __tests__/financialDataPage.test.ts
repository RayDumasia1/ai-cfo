import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../utils/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("../lib/db",()=>({getFinancialMonths:vi.fn(),getFinancialImportStatus:vi.fn(),getRecentFinancialImports:vi.fn(),hasPaidSubscription:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:vi.fn((url:string)=>{throw new Error(`redirect:${url}`);}),useRouter:()=>({refresh:vi.fn()})}));
import { createClient } from "../utils/supabase/server";
import { getFinancialMonths, getFinancialImportStatus, getRecentFinancialImports, hasPaidSubscription } from "../lib/db";
import FinancialDataPage from "../app/dashboard/financial-data/page";

const getUser = vi.fn();
const client = {auth:{getUser}};
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  getUser.mockResolvedValue({data:{user:{id:"own-account",email_confirmed_at:"2026-01-01",email:"test@example.invalid"}},error:null});
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(getFinancialMonths).mockResolvedValue([]);
  vi.mocked(getFinancialImportStatus).mockResolvedValue({available:true,lastImportedAt:null,filename:null});
  vi.mocked(getRecentFinancialImports).mockResolvedValue({available:true,imports:[]});
});

describe("Financial data page boundary and navigation",()=>{
  it.each(["missing","auth_error","unverified","unpaid"])("rejects %s before reading financial data",async condition=>{
    if(condition==="missing")getUser.mockResolvedValue({data:{user:null},error:null});
    if(condition==="auth_error")getUser.mockResolvedValue({data:{user:{id:"own-account"}},error:new Error("Auth failed")});
    if(condition==="unverified")getUser.mockResolvedValue({data:{user:{id:"own-account",email:"test@example.invalid"}},error:null});
    if(condition==="unpaid")vi.mocked(hasPaidSubscription).mockResolvedValue(false);
    await expect(FinancialDataPage()).rejects.toThrow(condition==="unpaid" ? "redirect:/welcome" : condition==="unverified" ? "redirect:/auth/verify" : "redirect:/auth?reason=session_expired");
    expect(getFinancialMonths).not.toHaveBeenCalled();
    expect(getFinancialImportStatus).not.toHaveBeenCalled();
    expect(getRecentFinancialImports).not.toHaveBeenCalled();
  });
  it("uses the authenticated account and shared uploader, with one route back to the dashboard",async()=>{
    const html = renderToStaticMarkup(await FinancialDataPage());
    expect(getFinancialMonths).toHaveBeenCalledExactlyOnceWith("own-account",null,client);
    expect(getFinancialImportStatus).toHaveBeenCalledExactlyOnceWith("own-account",client);
    expect(getRecentFinancialImports).toHaveBeenCalledExactlyOnceWith("own-account",10,client);
    expect(html).toContain("Financial data");
    expect(html).toContain("No financial data loaded yet.");
    expect(html).toContain("Choose file");
    expect(html).toContain("Download template");
    expect(html).toContain("Recent imports");
    expect(html).toContain('href="/downloads/elidan-financial-template-v2.xlsx"');
    expect(html.match(/href="\/dashboard"/g)).toHaveLength(1);
    expect(html).toContain("Back to dashboard");
    expect(html).not.toContain("View dashboard");
  });
});
