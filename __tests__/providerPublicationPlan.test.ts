import { describe,expect,it } from "vitest";
import { normalizeProviderCashMonth } from "../lib/providerCashNormalization";
import { planProviderMonthPublication,type StoredProviderMonth } from "../lib/providerPublicationPlan";
import { providerCashFixture } from "./fixtures/providerCash";
const fixture=()=>{
  const f=providerCashFixture(),normalized=normalizeProviderCashMonth(f.binding,f.batch,f.scope,f.evaluation);
  const stored:StoredProviderMonth={businessId:f.scope.businessId,month:{...normalized.month!},provenance:structuredClone(normalized.provenance)};
  return {normalized,stored};
};
describe("INT-01A source publication conflict plan",()=>{
  it("prepares new months without treating preflight as a write authorization",()=>{
    const {normalized}=fixture();expect(planProviderMonthPublication(normalized,null)).toMatchObject({action:"new_month",requiresAtomicRecheck:true,policyVersion:"provider-cash-1"});
  });
  it("never prepares incomplete source evidence for publication",()=>{
    const {normalized}=fixture();normalized.valid=false;normalized.month=null;
    expect(planProviderMonthPublication(normalized,null).action).toBe("blocked");
  });
  it("treats exact values/evidence as unchanged while preserving owner notes",()=>{
    const {normalized,stored}=fixture();stored.month.notes="Owner annotation";const before=structuredClone(stored);
    expect(planProviderMonthPublication(normalized,stored).action).toBe("unchanged");expect(stored).toEqual(before);
    stored.provenance!.retrievedAt="2026-10-28T12:09:00Z";stored.provenance!.batchId="new-retrieval";
    expect(planProviderMonthPublication(normalized,stored).action).toBe("unchanged");
  });
  it.each(["spreadsheet","manual","legacy_spreadsheet"] as const)("requires explicit source review before replacing %s history",source_type=>{
    const {normalized,stored}=fixture();stored.month.source_type=source_type;stored.provenance=null;
    expect(planProviderMonthPublication(normalized,stored).action).toBe("review_source_change");
  });
  it.each(["companyId","connectionId","generation"] as const)("requires source review when %s changes",key=>{
    const {normalized,stored}=fixture();stored.provenance!.scope[key]="other";
    expect(planProviderMonthPublication(normalized,stored).action).toBe("review_source_change");
  });
  it("requires source review for changed perimeter, missing registry or legacy workspace assignment",()=>{
    for(const change of ["perimeter","registry","assignment"]){
      const {normalized,stored}=fixture();if(change==="perimeter")stored.provenance!.cashAccountIds=["different-bank"];
      if(change==="registry")stored.provenance=null;if(change==="assignment")stored.businessId=null;
      expect(planProviderMonthPublication(normalized,stored).action).toBe("review_source_change");
    }
  });
  it("retains correction review even when changed evidence leaves monthly totals unchanged",()=>{
    const {normalized,stored}=fixture();stored.provenance!.evidenceFingerprint="b".repeat(64);
    expect(planProviderMonthPublication(normalized,stored).action).toBe("review_correction");
    stored.provenance!.evidenceFingerprint=normalized.provenance!.evidenceFingerprint;stored.month.closing_included_cash=2000;
    expect(planProviderMonthPublication(normalized,stored).action).toBe("review_correction");
  });
  it("blocks wrong-period and foreign-workspace comparisons instead of offering an overwrite",()=>{
    const {normalized,stored}=fixture();stored.month.month_date="2026-08-01";expect(planProviderMonthPublication(normalized,stored).action).toBe("blocked");
    stored.month.month_date="2026-09-01";stored.businessId="another-workspace";
    expect(planProviderMonthPublication(normalized,stored).action).toBe("blocked");
  });
});
