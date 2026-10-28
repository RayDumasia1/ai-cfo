import { describe,expect,it } from "vitest";
import { normalizeProviderCashMonth } from "../lib/providerCashNormalization";
import { normalizedCashHealth } from "../lib/normalizedCashHealth";
import type { FinancialMonth } from "../lib/types";
import { providerCashFixture,zeroProviderCashFixture } from "./fixtures/providerCash";
const run=(f:ReturnType<typeof providerCashFixture>)=>normalizeProviderCashMonth(f.binding,f.batch,f.scope,f.evaluation);
describe("INT-01A canonical cash normalization",()=>{
  it("projects a reconciled v2 month without counting transfers, unpaid invoices or funding as collections",()=>{
    const f=providerCashFixture(),before=structuredClone(f),result=run(f);
    expect(result.valid).toBe(true);expect(result.issues).toEqual([]);expect(result.counts).toEqual({cashMovements:12,internalTransfers:1,outsidePerimeter:1,nonCashDocuments:1});
    expect(result.month).toMatchObject({data_contract_version:2,source_type:"quickbooks",accounting_basis:"cash",period_status:"complete",period_cutoff_date:null,
      opening_included_cash:1500,closing_included_cash:1795,closing_unavailable_cash:100,cash_collected_from_customers:200,operating_cash_paid:175,
      owner_draws_paid:50,debt_principal_paid:100,debt_interest_paid:25,investing_cash_paid:200,investing_cash_received:80,debt_funding_received:500,
      owner_funding_received:60,other_cash_inflows:10,other_cash_outflows:5,total_revenue:200,total_expenses:555,payroll:null,ar_outstanding:null,ap_outstanding:null});
    expect(result.reconciliation.map(r=>r.difference)).toEqual([0,0]);expect(f).toEqual(before);
    const row={...result.month!,id:"month",user_id:"owner",business_id:f.scope.businessId,cash_reconciliation_difference:0,created_at:"2026-10-28",updated_at:"2026-10-28"} as FinancialMonth;
    expect(normalizedCashHealth([row])).toMatchObject({cash:{availableCash:1695},operating:{averageCashCollected:200,averageCashPaid:175,averageNetCashFlow:25,direction:"cash_generating"}});
  });
  it("requires explicit complete evidence before an empty source can mean zero",()=>{
    const f=zeroProviderCashFixture();expect(run(f).month).toMatchObject({opening_included_cash:0,closing_included_cash:0,cash_collected_from_customers:0,operating_cash_paid:0,available_credit:null});
    f.batch.paginationComplete=false;expect(run(f)).toMatchObject({valid:false,month:null,issues:expect.arrayContaining([expect.objectContaining({code:"incomplete_retrieval"})])});
  });
  it.each(["failed","partial"] as const)("rejects %s retrieval even when the received subset balances",status=>{
    const f=zeroProviderCashFixture();f.batch.retrievalStatus=status;expect(run(f).valid).toBe(false);
  });
  it("does not let offsetting account errors pass an aggregate reconciliation",()=>{
    const f=providerCashFixture();f.batch.movements=f.batch.movements.filter(m=>m.sourceEventId!=="Transfer:internal:1");
    const result=run(f);expect(result.month).toBeNull();expect(result.reconciliation.map(r=>r.difference)).toEqual([-150,150]);
    expect(result.issues.filter(i=>i.code==="unreconciled_account")).toHaveLength(2);
  });
  it("keeps missing balances and unconfirmed unavailable cash distinct from zero",()=>{
    const f=zeroProviderCashFixture();f.batch.accounts[0].closingBalance=null;
    expect(run(f)).toMatchObject({valid:false,month:null,issues:expect.arrayContaining([expect.objectContaining({code:"missing_balance"})])});
    const g=zeroProviderCashFixture();g.batch.unavailableCashConfirmed=false;expect(run(g).valid).toBe(false);
  });
  it("supports overdrafts while enforcing the unavailable-cash bound",()=>{
    const f=zeroProviderCashFixture();f.batch.accounts[0].openingBalance="-50.00";f.batch.accounts[0].closingBalance="-50.00";
    expect(run(f).month?.closing_included_cash).toBe(-50);f.batch.closingUnavailableCash="0.01";
    expect(run(f).issues).toEqual(expect.arrayContaining([expect.objectContaining({code:"unavailable_cash_invalid"})]));
  });
  it("uses exact minor units rather than floating-point accumulation",()=>{
    const f=zeroProviderCashFixture();f.batch.accounts[0].openingBalance="0.30";
    const sample=providerCashFixture().batch.movements[1];f.batch.movements=[{...sample,sourceEventId:"Payment:a",amount:"0.10"},{...sample,sourceEventId:"Payment:b",amount:"0.20"}];
    expect(run(f)).toMatchObject({valid:true,month:{operating_cash_paid:0.3,total_expenses:0.3,closing_included_cash:0}});
    f.batch.movements[0].amount="0.10001";expect(run(f).valid).toBe(false);
    const four=zeroProviderCashFixture();four.binding.currencyPrecision=4;four.batch.accounts[0].closingBalance="0.0001";
    four.batch.movements=[{...providerCashFixture().batch.movements[0],amount:"0.0001"}];
    expect(run(four)).toMatchObject({valid:true,month:{cash_collected_from_customers:0.0001,closing_included_cash:0.0001}});
    const integer=zeroProviderCashFixture();integer.binding.currencyPrecision=0;integer.binding.reportingCurrency="JPY";integer.scope.reportingCurrency="JPY";integer.batch.scope.reportingCurrency="JPY";
    integer.batch.accounts[0]={...integer.batch.accounts[0],reportingCurrency:"JPY",openingBalance:"0",closingBalance:"1"};integer.batch.closingUnavailableCash="0";
    integer.batch.movements=[{...providerCashFixture().batch.movements[0],reportingCurrency:"JPY",amount:"1"}];
    expect(run(integer)).toMatchObject({valid:true,month:{cash_collected_from_customers:1,reporting_currency:"JPY"}});
  });
  it("preserves independently prepared cent partitions across different event splits",()=>{
    for(let first=0;first<=100;first+=5){
      const f=zeroProviderCashFixture();f.batch.accounts[0].closingBalance="1.00";
      const sample=providerCashFixture().batch.movements[0];f.batch.movements=[{...sample,sourceEventId:"Payment:first",amount:(first/100).toFixed(2)},
        {...sample,sourceEventId:"Payment:second",amount:((100-first)/100).toFixed(2)}];
      expect(run(f)).toMatchObject({valid:true,month:{cash_collected_from_customers:1,closing_included_cash:1,total_revenue:1}});
    }
  });
  it("produces stable evidence identity across page order, batch IDs and retrieval retries",()=>{
    const f=providerCashFixture(),first=run(f);f.batch.movements.reverse();f.batch.accounts.reverse();f.binding.cashAccountIds.reverse();
    f.batch.batchId="batch-2";f.batch.retrievedAt="2026-10-28T12:05:00Z";
    expect(run(f).provenance?.evidenceFingerprint).toBe(first.provenance?.evidenceFingerprint);
    expect(run(f).provenance?.cashPerimeterFingerprint).toBe(first.provenance?.cashPerimeterFingerprint);
    f.batch.movements.find(m=>m.sourceEventId==="Payment:customer:1")!.sourceRevision="2";
    expect(run(f).provenance?.evidenceFingerprint).not.toBe(first.provenance?.evidenceFingerprint);
  });
  it.each(["businessId","companyId","connectionId","generation","reportingCurrency"] as const)("rejects a stale or foreign %s",key=>{
    const f=providerCashFixture();f.batch.scope[key]="different";expect(run(f).valid).toBe(false);expect(run(f).month).toBeNull();
  });
  it("rejects disconnected work and jobs invalidated by Clear Data's future generation rotation",()=>{
    const f=providerCashFixture();f.binding.status="disconnected";expect(run(f).issues.some(i=>i.code==="disconnected")).toBe(true);
    f.binding.status="connected";f.binding.generation="generation-after-clear";expect(run(f).issues.some(i=>i.code==="stale_generation")).toBe(true);
  });
  it("rejects an incomplete or changed cash perimeter",()=>{
    const f=providerCashFixture();f.batch.accounts.pop();expect(run(f).valid).toBe(false);
    const g=providerCashFixture();g.batch.accounts.push({...g.batch.accounts[0]});expect(run(g).valid).toBe(false);
    const h=providerCashFixture();h.binding.cashPerimeterConfirmed=false;expect(run(h).valid).toBe(false);
  });
  it("rejects duplicate, unclassified, mixed-currency and nonposted cash events",()=>{
    for(const change of ["duplicate","classification","currency","voided","pending"]){
      const f=providerCashFixture();if(change==="duplicate")f.batch.movements.push({...f.batch.movements[0]});
      if(change==="classification")f.batch.movements[0].classification=null;
      if(change==="currency")f.batch.movements[0].reportingCurrency="EUR";
      if(change==="voided")f.batch.movements[0].status="voided";
      if(change==="pending")f.batch.movements[0].status="pending";
      expect(run(f).valid,change).toBe(false);
    }
  });
  it("never classifies internal transfers as customer collections",()=>{
    const f=providerCashFixture();f.batch.movements[3].classification="cash_collected_from_customers";expect(run(f).valid).toBe(false);
    const g=providerCashFixture();g.batch.movements[3].kind="cash_movement";expect(run(g).valid).toBe(false);
  });
  it("rejects report totals, non-cash documents carrying cash legs and direction conflicts",()=>{
    const f=providerCashFixture();f.batch.sourceBasis="report_totals" as never;expect(run(f).valid).toBe(false);
    const g=providerCashFixture();g.batch.movements.find(m=>m.kind==="non_cash_document")!.toAccountId="bank-a";expect(run(g).valid).toBe(false);
    const h=providerCashFixture();h.batch.movements[0].fromAccountId="bank-a";h.batch.movements[0].toAccountId=null;expect(run(h).valid).toBe(false);
  });
  it("puts a transfer crossing the selected cash perimeter in other cash, not operating performance",()=>{
    const f=zeroProviderCashFixture();f.batch.accounts[0].openingBalance="100.00";f.batch.accounts[0].closingBalance="70.00";
    f.batch.movements=[{...providerCashFixture().batch.movements[3],fromAccountId:"bank-a",toAccountId:"restricted-outside",amount:"30.00"}];
    expect(run(f)).toMatchObject({valid:true,month:{other_cash_outflows:30,operating_cash_paid:0,total_expenses:30}});
  });
  it("requires closed full periods, matched balance dates and fresh retrieval evidence",()=>{
    for(const key of ["window","balance_date","future_retrieval","stale_retrieval","current_month"]){
      const f=providerCashFixture();if(key==="window")f.batch.windowStart="2026-09-02";
      if(key==="balance_date")f.batch.accounts[0].closingDate="2026-10-28";
      if(key==="future_retrieval")f.batch.retrievedAt="2026-10-28T12:11:00Z";
      if(key==="stale_retrieval")f.batch.retrievedAt="2026-10-28T10:00:00Z";
      if(key==="current_month")f.evaluation.date="2026-09-30";
      expect(run(f).valid,key).toBe(false);
    }
  });
  it("rejects unsafe amounts and bounded input overflow without throwing",()=>{
    const f=zeroProviderCashFixture();f.batch.accounts[0].openingBalance="999999999999999999999999.00";expect(run(f).valid).toBe(false);
    const g=providerCashFixture();g.batch.movements=Array(10001).fill(g.batch.movements[0]);expect(run(g).valid).toBe(false);
    const h=zeroProviderCashFixture();h.batch.accounts[0].openingBalance="90071992547409.91";h.batch.accounts[0].closingBalance="90071992547409.91";
    expect(run(h).valid).toBe(false); // JSON numeric output would lose a cent.
  });
});
