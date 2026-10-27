import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";
import { getForecastReviewEvidence, getForecastReviewQueue, getForecastReviewReplay, getOwnerForecastReview,
  hasPaidSubscription, recordManualForecastActual, saveForecastReview } from "@/lib/db";
import { prepareForecastReview, type ForecastReviewCommand } from "@/lib/forecastReviewStorage";
import { isReviewId, parseManualActual, parseReviewSelection, parseReviewSubmission, REVIEW_POLICY, ReviewInputError } from "@/lib/forecastReviewWorkflow";
import { todayIso } from "@/lib/forecastWorkflow";
import { createServiceClient } from "@/utils/supabase/service";

export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
function failure(error:unknown):Response {
  if(error instanceof ReviewInputError)return json({error:error.message},400);
  const code=error && typeof error==="object" && "code" in error ? String(error.code):null;
  if(code==="40001")return json({error:"This week’s evidence changed. Reload the week, check the entries and calculate again."},409);
  if(code==="P0002")return json({error:"This saved plan was not found."},404);
  if(["23514","23503","23505","22023","22P02"].includes(code??""))return json({error:"Check the week, match decisions and amounts, then calculate again."},400);
  throw error;
}
async function readBody(req:NextRequest):Promise<Record<string,unknown>> {
  const reader=req.body?.getReader(); if(!reader)throw new ReviewInputError("Request is empty.");
  const decoder=new TextDecoder();let size=0,text="";
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>262144){await reader.cancel();throw new ReviewInputError("Review is too large. Save fewer match decisions at once.");}
      text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();const value=JSON.parse(text);
    if(!value || typeof value!=="object" || Array.isArray(value))throw new Error();
    return value;
  }catch(error){if(error instanceof ReviewInputError)throw error;throw new ReviewInputError("Invalid review request.");}
  finally{reader.releaseLock();}
}

export const GET=requireAuth(async(req,{userId,email,supabase})=>{
  if(!await hasPaidSubscription(userId,supabase))return json({error:"An active paid plan is required."},402);
  const gate=await checkFeatureGate(userId,email,"forecast_variance",supabase);if(gate)return gate;
  const admin=createServiceClient();
  try{
    if(!req.nextUrl.searchParams.has("versionId"))return json(await getForecastReviewQueue(userId,todayIso(),admin));
    const s=parseReviewSelection(Object.fromEntries(req.nextUrl.searchParams));
    const reviewId=req.nextUrl.searchParams.get("reviewId");
    if(reviewId!==null&&!isReviewId(reviewId))throw new ReviewInputError("Choose a saved review revision.");
    return json(await getOwnerForecastReview(userId,s.versionId,s.weekStart,admin,reviewId??undefined));
  }catch(error){return failure(error);}
});

export const POST=requireAuth(async(req,{userId,email,supabase})=>{
  if(!await hasPaidSubscription(userId,supabase))return json({error:"An active paid plan is required."},402);
  const gate=await checkFeatureGate(userId,email,"forecast_variance",supabase);if(gate)return gate;
  try{
    const body=await readBody(req),admin=createServiceClient();
    if(body.action==="record_actual"){
      const s=parseManualActual(body),e=await getForecastReviewEvidence(userId,s.versionId,s.weekStart,admin);
      if(s.cashDate<e.week_start || s.cashDate>e.week_end || s.cashDate>todayIso())throw new ReviewInputError("Use the date cash moved within the selected week.");
      const previous=s.correctionId ? e.actual_events.find(i=>i.id===s.correctionId) : null;
      if(s.correctionId && !s.note)throw new ReviewInputError("Explain why you are correcting this cash entry.");
      if(previous && previous.source_type!=="manual")throw new ReviewInputError("Only manual cash entries can be corrected here.");
      // A retry after a successful correction sees a new head. Locate it by its
      // stable source identity only when the original is no longer in evidence.
      let identity: { source_event_id:string;source_connection?:string }|null=previous??null;
      if(s.correctionId && !previous){
        const {data:original,error}=await admin.from("cash_actual_events").select("source_event_id,source_connection,source_type,business_id")
          .eq("id",s.correctionId).eq("user_id",userId).maybeSingle();
        if(error)throw error;
        if(original?.source_type==="manual" && original.business_id===e.business_id && original.source_connection==="owner-manual")identity=original;
      }
      if(s.correctionId && (!identity || (identity as {source_connection?:string}).source_connection!=="owner-manual"))
        throw new ReviewInputError("Only your manually entered cash movements can be corrected here.");
      const details={description:s.description,note:s.note};
      const event={reporting_currency:e.reporting_currency,cash_date:s.cashDate,amount:s.amount,direction:s.direction,
        category:s.category,source_type:"manual",source_connection:"owner-manual",
        source_event_id:identity?.source_event_id??s.requestKey,source_created_at:null,source_updated_at:null,
        ingestion_batch:s.requestKey,payload_fingerprint:createHash("sha256").update(JSON.stringify({date:s.cashDate,amount:s.amount,direction:s.direction,category:s.category,...details})).digest("hex"),
        lineage:details,manual_entry:true};
      return json(await recordManualForecastActual(userId,e.business_id,event,s.correctionId,admin));
    }
    if(body.action!=="calculate" && body.action!=="save")throw new ReviewInputError("Choose a supported review action.");
    const s=parseReviewSubmission(body);
    const policy={...REVIEW_POLICY,ownerActivityConfirmed:s.activityConfirmed};
    let command:ForecastReviewCommand;
    const prior=body.action==="save" ? await getForecastReviewReplay(userId,s.requestKey,admin):null;
    if(prior){
      const expected={version:s.versionId,week:s.weekStart,token:s.evidenceToken,allocations:s.allocations,
        policy,opening:s.openingCash,closing:s.closingCash};
      const {result,...original}=prior;
      if(!isDeepStrictEqual(expected,original))return json({error:"This save request was already used for a different review. Reload the week."},409);
      command={userId,versionId:s.versionId,weekStart:s.weekStart,requestKey:s.requestKey,evidenceToken:s.evidenceToken,
        allocations:s.allocations,policy,openingCash:s.openingCash,closingCash:s.closingCash,result};
    }else{
      const e=await getForecastReviewEvidence(userId,s.versionId,s.weekStart,admin);
      if(e.evidence_token!==s.evidenceToken)return json({error:"This week’s evidence changed. Reload the week before calculating."},409);
      try{command=prepareForecastReview(userId,e,{...s,policy,evaluationDate:todayIso()});}
      catch{throw new ReviewInputError("Check the match decisions: references must belong to this week, directions must agree, and allocated amounts cannot exceed an entry.");}
      if(!s.activityConfirmed && command.result.coverage==="complete"){
        command.result.coverage="partial";
        command.result.warnings.push({code:"unresolved_evidence",allocationId:null,plannedItemId:null,actualEventId:null,
          message:"Confirm that the week’s cash movements have been checked against your records."});
      }
      // Item-level differences remain exact, but a whole-week cash effect is
      // not established until activity, matching and balances are complete.
      if(command.result.coverage!=="complete")command.result.summary.netCashImpact=null;
    }
    if(body.action==="calculate")return json({result:command.result});
    const saved=await saveForecastReview(command,admin);
    return json({...saved,result:command.result});
  }catch(error){return failure(error);}
});
