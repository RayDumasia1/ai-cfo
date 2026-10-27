import { describe,expect,it } from "vitest";
import { buildReviewQueue,ownerReviewEvidence,parseReviewSubmission,reviewMoney,reviewResultGuidance } from "../lib/forecastReviewWorkflow";
import { rawReviewEvidence,reviewFixtureResult,reviewIds,reviewSubmission } from "./fixtures/forecastReview";
describe("Weekly review evidence and owner guidance",()=>{
  it("lists only full closed forecast weeks and the newest revision for each plan",()=>{
    const versions=[{id:reviewIds.version,version_number:2,start_date:"2026-10-05"},
      {id:"old",version_number:1,start_date:"2026-09-28"}];
    const reviews=[{id:"first",version_id:reviewIds.version,week_start:"2026-10-05",revision:1,coverage:"partial" as const},
      {id:"second",version_id:reviewIds.version,week_start:"2026-10-05",revision:2,coverage:"complete" as const}];
    expect(buildReviewQueue(versions,reviews,"2026-10-11").filter(w=>w.versionId===reviewIds.version)).toHaveLength(0);
    const queue=buildReviewQueue(versions,reviews,"2026-10-12");
    expect(queue[0]).toMatchObject({versionId:reviewIds.version,weekStart:"2026-10-05",weekEnd:"2026-10-11",reviewId:"second",revision:2,coverage:"complete"});
    expect(buildReviewQueue([versions[0]],[],"2027-12-01")).toHaveLength(13);
  });
  it("preserves owner-facing evidence and strips private provider payloads",()=>{
    const safe=ownerReviewEvidence(rawReviewEvidence);
    expect(safe.actual_events[0]).toMatchObject({description:"Customer deposit",editable:true,amount:900});
    expect(JSON.stringify(safe)).not.toContain("privateProviderPayload");expect(JSON.stringify(safe)).not.toContain("must-not-reach-browser");
  });
  it("preserves explicit zero while requiring both balances or neither",()=>{
    expect(parseReviewSubmission({...reviewSubmission,openingCash:0,closingCash:0})).toMatchObject({openingCash:0,closingCash:0});
    expect(parseReviewSubmission({...reviewSubmission,openingCash:null,closingCash:null})).toMatchObject({openingCash:null,closingCash:null});
    expect(()=>parseReviewSubmission({...reviewSubmission,openingCash:""})).toThrow();
    expect(()=>parseReviewSubmission({...reviewSubmission,openingCash:0,closingCash:null})).toThrow();
    expect(reviewMoney(1.00001)).toBe(false);expect(reviewMoney(1.0001)).toBe(true);expect(reviewMoney(Infinity)).toBe(false);
  });
  it("does not describe unresolved or unreconciled cash as performance",()=>{
    const partial=structuredClone(reviewFixtureResult);partial.coverage="partial";partial.reconciliation.reconciled=false;partial.reconciliation.unexplainedDifference=20;
    expect(reviewResultGuidance(partial)).toMatchObject({title:"This week still needs checking",detail:expect.stringContaining("do not explain")});
    const reserve=structuredClone(reviewFixtureResult);reserve.summary.closingCashBelowReserve=true;
    expect(reviewResultGuidance(reserve).detail).toContain("below your protected reserve");
  });
});
