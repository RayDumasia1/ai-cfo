import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { checkFeatureGate } from "@/lib/apiGate";
import { calculateCashForecast, type ForecastCashItem } from "@/lib/cashForecast";
import { FORECAST_FRESHNESS_POLICY, parseForecastDraftDiscardResult, parseForecastItem, todayIso } from "@/lib/forecastWorkflow";
import { createServiceClient } from "@/utils/supabase/service";

export const dynamic="force-dynamic";

async function load(userId:string, admin:ReturnType<typeof createServiceClient>) {
  const {data:forecast,error:fError}=await admin.from("cash_forecasts").select("*").eq("user_id",userId).is("archived_at",null).maybeSingle();
  if(fError) throw fError;
  if(!forecast) return {forecast:null,version:null,items:[]};
  const {data:versions,error:vError}=await admin.from("cash_forecast_versions").select("*").eq("forecast_id",forecast.id).eq("user_id",userId).in("status",["draft","published"]).order("version_number",{ascending:false});
  if(vError) throw vError;
  const version=versions?.find(v=>v.status==="draft")??versions?.find(v=>v.status==="published")??null;
  if(!version) return {forecast,version:null,items:[]};
  const {data:items,error:iError}=await admin.from("cash_forecast_items").select("*").eq("version_id",version.id).eq("user_id",userId).order("expected_date");
  if(iError) throw iError;
  return {forecast,version,items:items??[]};
}

export const GET=requireAuth(async(_req,{userId,email,supabase})=>{
  const gate=await checkFeatureGate(userId,email,"forecasting",supabase); if(gate)return gate;
  return NextResponse.json(await load(userId,createServiceClient()),{headers:{"Cache-Control":"no-store"}});
});

export const POST=requireAuth(async(req:NextRequest,{userId,email,supabase})=>{
  const gate=await checkFeatureGate(userId,email,"forecasting",supabase); if(gate)return gate;
  const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body||typeof body.action!=="string") return NextResponse.json({error:"Invalid request"},{status:400});
  const admin=createServiceClient();
  if(body.action==="begin"||body.action==="revise"||body.action==="update_start") {
    const asOf=String(body.asOfDate??""),start=String(body.startDate??"");
    const cash=typeof body.startingCash==="number"?body.startingCash:Number.NaN;
    const reserve=typeof body.minimumReserve==="number"?body.minimumReserve:Number.NaN;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||start<asOf||!Number.isFinite(cash)||cash<0||!Number.isFinite(reserve)||reserve<0)
      return NextResponse.json({error:"Enter valid starting cash, reserve, and dates."},{status:400});
    let result;
    if(body.action==="update_start") {
      const versionId=String(body.versionId??""), expectedUpdatedAt=String(body.expectedUpdatedAt??"");
      if(!/^[0-9a-f-]{36}$/i.test(versionId)||!expectedUpdatedAt)
        return NextResponse.json({error:"Reload the draft and try again."},{status:409});
      const {data,error}=await admin.from("cash_forecast_versions").update({
        as_of_date:asOf,start_date:start,starting_included_cash:cash,minimum_reserve:reserve,
        updated_at:new Date().toISOString(),
      }).eq("id",versionId).eq("user_id",userId).eq("status","draft").eq("updated_at",expectedUpdatedAt).select("id").maybeSingle();
      if(error)throw error;
      if(!data)return NextResponse.json({error:"This draft changed. Reload it before updating the starting point."},{status:409});
      return NextResponse.json(await load(userId,admin));
    } else if(body.action==="revise") {
      result=(await admin.rpc("begin_core_forecast_revision",{p_user_id:userId,p_published_version_id:String(body.versionId),p_as_of_date:asOf,p_start_date:start,p_starting_included_cash:cash,p_minimum_reserve:reserve}));
    } else {
      const {data:profile,error}=await admin.from("business_profiles").select("id,data_version").eq("user_id",userId).single(); if(error)throw error;
      result=await admin.rpc("begin_cash_forecast_draft",{p_user_id:userId,p_business_id:profile.id,p_reporting_currency:"USD",p_as_of_date:asOf,p_start_date:start,p_starting_included_cash:cash,p_starting_unavailable_cash:0,p_minimum_reserve:reserve,p_source_data_version:profile.data_version,p_formula_policy_version:"forecast-1",p_source_snapshot:{source:"manual"},p_parent_version_id:null});
    }
    if(result.error) {
      if(body.action==="revise"&&result.error.code==="23505")
        return NextResponse.json(await load(userId,admin));
      if(body.action==="revise"&&result.error.code==="55000")
        return NextResponse.json({error:"A weekly plan update is already in progress. Reload to continue it."},{status:409});
      throw result.error;
    }
    return NextResponse.json(await load(userId,admin));
  }
  const state=await load(userId,admin); if(!state.version||state.version.status!=="draft")return NextResponse.json({error:"Start or update a draft first."},{status:409});
  if(body.action==="discard") {
    const versionId=String(body.versionId??""), expectedUpdatedAt=String(body.expectedUpdatedAt??"");
    if(versionId!==state.version.id||expectedUpdatedAt!==state.version.updated_at)
      return NextResponse.json({error:"This draft changed. Reload it before discarding it."},{status:409});
    const {data,error}=await admin.rpc("discard_cash_forecast_draft",{
      p_user_id:userId,p_version_id:versionId,p_expected_updated_at:expectedUpdatedAt,
    });
    if(error)throw error;
    const result=parseForecastDraftDiscardResult(data);
    if(!result)throw new Error("Invalid draft discard result");
    if(!result.discarded) {
      const message=result.reason==="linked_action"
        ?"This draft is linked to an action. Remove that action before discarding the draft."
        :result.reason==="linked_version"
          ?"This draft is used by another weekly plan and cannot be discarded."
          :"This draft changed. Reload it before discarding it.";
      return NextResponse.json({error:message},{status:409});
    }
    return NextResponse.json(await load(userId,admin));
  }
  if(body.action==="save_item") {
    const parsed=parseForecastItem(body.item); if(!parsed.ok)return NextResponse.json({error:parsed.error},{status:400});
    const i=parsed.value; const row={version_id:state.version.id,user_id:userId,item_key:i.id??crypto.randomUUID(),description:i.description,amount:i.amount,direction:i.direction,category:i.category,expected_date:i.expectedDate,status:i.status,confidence:i.confidence,amount_is_estimated:i.amountIsEstimate,date_is_estimated:i.dateIsEstimate,zero_confirmed:i.amount===0,source_type:"manual",source_updated_at:todayIso(),created_by:userId,updated_by:userId};
    const query=i.id?admin.from("cash_forecast_items").update(row).eq("id",i.id).eq("version_id",state.version.id).eq("user_id",userId):admin.from("cash_forecast_items").insert(row);
    const {error}=await query;if(error)throw error;return NextResponse.json(await load(userId,admin));
  }
  if(body.action==="delete_item") { const {error}=await admin.from("cash_forecast_items").delete().eq("id",String(body.itemId)).eq("version_id",state.version.id).eq("user_id",userId);if(error)throw error;return NextResponse.json(await load(userId,admin)); }
  if(body.action==="publish") {
    const items:ForecastCashItem[]=state.items.map(i=>({id:i.id,description:i.description,amount:i.amount,direction:i.direction,category:i.category,expectedDate:i.expected_date,status:i.status,confidence:i.confidence,sourceType:i.source_type,sourceUpdatedAt:i.source_updated_at?.slice(0,10)??null,amountIsEstimate:i.amount_is_estimated,dateIsEstimate:i.date_is_estimated}));
    const result=calculateCashForecast({startDate:state.version.start_date,asOfDate:state.version.as_of_date,evaluationDate:todayIso(),startingAvailableCash:state.version.starting_included_cash,minimumReserve:state.version.minimum_reserve,reportingCurrency:state.forecast.reporting_currency,items,freshnessPolicy:FORECAST_FRESHNESS_POLICY});
    if(!result.valid)return NextResponse.json({error:"Resolve the weekly cash plan errors before publishing.",details:result.errors},{status:400});
    const published=await admin.rpc("publish_cash_forecast_version",{p_user_id:userId,p_forecast_id:state.forecast.id,p_version_id:state.version.id,p_calculation_result:result,p_expected_updated_at:state.version.updated_at});if(published.error)throw published.error;
    return NextResponse.json(await load(userId,admin));
  }
  return NextResponse.json({error:"Unsupported action"},{status:400});
});
