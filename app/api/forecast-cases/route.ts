import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";
import { readBoundedJson,RequestBodyError } from "@/lib/apiRequestBody";
import { getForecastCases,getForecastCaseReplay,hasPaidSubscription,saveForecastCase } from "@/lib/db";
import { calculateForecastCase,forecastCasesView,ForecastCaseInputError,parseCaseSubmission,type CaseCalculation } from "@/lib/forecastCases";
import { isReviewId } from "@/lib/forecastReviewWorkflow";
import { todayIso } from "@/lib/forecastWorkflow";
import { createServiceClient } from "@/utils/supabase/service";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
function fail(error:unknown):Response{
  if(error instanceof ForecastCaseInputError||error instanceof RequestBodyError)return json({error:error.message},400);
  const code=error&&typeof error==="object"&&"code" in error?String(error.code):null;
  if(code==="P0002")return json({error:"That published base plan was not found."},404);
  if(code==="54000")return json({error:"This base exceeds the current 2,000-item limit for saved cases."},400);
  if(code==="40001")return json({error:"The base plan changed. Reload and choose the current published base before saving."},409);
  if(["22023","22P02","23514","23505"].includes(code??""))return json({error:"Check the case assumptions and reload before saving."},400);
  throw error;
}
export const GET=requireAuth(async(req,{userId,email,supabase})=>{
  if(!await hasPaidSubscription(userId,supabase))return json({error:"An active paid plan is required."},402);
  const gate=await checkFeatureGate(userId,email,"scenario_comparison",supabase);if(gate)return gate;
  try{const id=req.nextUrl.searchParams.get("baseVersionId");if(id!==null&&!isReviewId(id))throw new ForecastCaseInputError("Choose a saved base plan.");
    return json(forecastCasesView(await getForecastCases(userId,id,createServiceClient()),todayIso()));}catch(error){return fail(error);}
});
export const POST=requireAuth(async(req,{userId,email,supabase})=>{
  if(!await hasPaidSubscription(userId,supabase))return json({error:"An active paid plan is required."},402);
  const gate=await checkFeatureGate(userId,email,"scenario_comparison",supabase);if(gate)return gate;
  try{
    const body=await readBoundedJson(req);if(body.action!=="calculate"&&body.action!=="save")throw new ForecastCaseInputError("Choose calculate or save.");
    const input=parseCaseSubmission(body),admin=createServiceClient();let calculation:CaseCalculation;
    const prior=body.action==="save"?await getForecastCaseReplay(userId,input.requestKey,admin):null;
    if(prior){
      const {caseResult,baseResult,evaluationDate,...original}=prior;
      const {requestKey,...expected}=input;void requestKey;
      if(!isDeepStrictEqual(expected,original))return json({error:"This save request was already used with different assumptions. Reload the cases."},409);
      calculation={caseResult,baseResult,evaluationDate};
    }else{
      const state=await getForecastCases(userId,input.baseVersionId,admin);
      if(!state.base)return json({error:"Publish a base cash plan first."},404);
      calculation=calculateForecastCase(state.base,input.assumptions,todayIso());
    }
    if(body.action==="calculate")return json({calculation});
    return json({...await saveForecastCase(userId,input,calculation,admin),calculation});
  }catch(error){return fail(error);}
});
