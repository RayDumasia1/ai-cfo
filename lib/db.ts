/**
 * Typed database query functions for Elidan AI.
 *
 * Rules:
 *   - Every function accepts userId explicitly — no global auth state.
 *   - Throws on unexpected errors; callers handle UI feedback.
 *
 * RLS note: functions that default to the browser (anon) client are subject
 * to Row Level Security via `auth.uid() = user_id`. Server route handlers
 * must pass the server SupabaseClient (from utils/supabase/server.ts) so the
 * authenticated session is present and RLS resolves correctly.
 */

import { supabase } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan, FeatureTier } from "./featureGates";
import type { CheckoutAttempt } from "./subscriptionCheckout";
import type { FinancialImportHistory, FinancialImportStatus } from "./financialDataStatus";
import { areConsecutiveFinancialMonths } from "./calculations";
import { FOUNDING_MEMBER_SPOTS } from "./launchConfig";
import { DASHBOARD_MONTH_LIMIT, importedBusinessDetails, isFinancialImportResult, type FinancialImportMode, type FinancialImportResult } from "./financialImportPolicy";
import { isMonthList, type ImportReviewState } from "./financialImportReview";
import type {
  Action,
  ActionAuditLog,
  ActionInsert,
  ActionStatus,
  ActionUpdate,
  BusinessProfile,
  BusinessProfileInsert,
  DataImport,
  DataImportInsert,
  DismissedAlert,
  ExpenseCategory,
  ExpenseCategoryInsert,
  FinancialMonth,
  FinancialMonthInsert,
  SnoozeType,
  UserAlertPreferences,
} from "./types";
import type {ForecastDecisionContext} from "./cashPlanDecision";
import type { ForecastReviewCommand, ForecastReviewEvidence } from "./forecastReviewStorage";
import { buildReviewQueue, ownerReviewEvidence, type OwnerReviewState, type ReviewQueueItem } from "./forecastReviewWorkflow";
import type { CaseBase, CaseCalculation, ForecastCasesState, SavedForecastCase, parseCaseSubmission } from "./forecastCases";
import type { TokenEnvelope } from "./quickbooks";
import { OrganizationAccessError, validateOwnerMonthlyRead, validateOwnerOrganizations } from "./organizationAccess";
import { MonthlyAuthorityError, monthlyFailure, validateOwnerWriteContext, assertMonthlyAcknowledgment } from "./monthlyAuthority";

function organizationReadFailure(code: string | undefined): never {
  throw new OrganizationAccessError(code === "P0002" ? "not_found" : code === "42501" ? "unauthorized" : "unavailable");
}
/** Authenticated client only. SQL binds auth.uid(); an actor is never sent as an RPC argument. */
export async function getOwnerOrganizationMonths(actorId: string, selected: string | null, limit: number | null, client: SupabaseClient) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 240)) throw new OrganizationAccessError("invalid_selection");
  const { data, error } = await client.rpc("read_owned_financial_months", { p_organization_id: selected, p_limit: limit });
  if (error) organizationReadFailure(error.code);
  return validateOwnerMonthlyRead(data, actorId, selected, limit);
}
export async function getOwnerOrganizations(client: SupabaseClient) {
  const { data, error } = await client.rpc("list_owned_organizations");
  if (error) organizationReadFailure(error.code);
  return validateOwnerOrganizations(data);
}
/** A read-only budget preflight; it never replaces the locked mutation check. */
export async function authorizeOwnedMonthly(actorId:string,selected:string|null,client:SupabaseClient):Promise<void>{
  const {data,error}=await client.rpc("owned_monthly_operation",{p_operation:"authorize",p_organization_id:selected});
  if(error)monthlyFailure(error);
  if(!data||data.authorized!==true||data.actorId!==actorId||(selected!==null&&data.organizationId!==selected))throw new MonthlyAuthorityError("unavailable");
}
export async function prepareOwnedFinancialImport(actorId:string,months:Omit<FinancialMonthInsert,"user_id"|"business_id">[],
  profile:Partial<Omit<BusinessProfileInsert,"user_id">>,mode:FinancialImportMode,client:SupabaseClient,selected:string|null=null){
  const {data,error}=await client.rpc("owned_monthly_operation",{p_operation:"review",p_organization_id:selected,p_months:months,p_profile:importedBusinessDetails(profile),p_mode:mode});
  if(error)monthlyFailure(error);
  const context=validateOwnerWriteContext(data?.context,actorId,selected);
  if(typeof data?.unchanged!=="boolean"||!data.reviewState||typeof data.reviewState.state_version!=="string"||
    !/^[a-f0-9]{32}$/.test(data.reviewState.state_version)||!isMonthList(data.reviewState.months))throw new MonthlyAuthorityError("unavailable");
  return{context,reviewState:data.reviewState as ImportReviewState,unchanged:data.unchanged as boolean};
}

/** Server-only caller: never serialize this record (it may carry encrypted credentials).
 * Actor comes from requireAuth; business ID from the account-owned profile lookup.
 */
export interface QuickBooksConnectionRecord {
  id: string; businessId: string; generation: string; environment: "sandbox";
  realmId: string | null; companyName: string | null;
  status: "disconnected" | "authorizing" | "exchanging" | "verifying" | "connected" | "refreshing" | "reconnect_required" | "revoke_pending" | "revoking";
  operationId: string | null; credentialRevision: number;
  connectedAt: string | null; disconnectedAt: string | null;
  envelope?: TokenEnvelope | null; credentialGeneration?: string; accessExpiresAt?: string; refreshExpiresAt?: string;
}
export async function quickBooksLifecycle(actorId: string, businessId: string, action: string, input: Record<string, unknown>, client: SupabaseClient): Promise<QuickBooksConnectionRecord | null> {
  const { data, error } = await client.rpc("quickbooks_lifecycle", { p_actor: actorId, p_business: businessId, p_action: action, p_input: input });
  if (error) throw Object.assign(new Error("Connection storage failed"), { code: error.code });
  if (data === null) return null;
  if (!data || typeof data.id !== "string" || typeof data.businessId !== "string" || typeof data.generation !== "string" || typeof data.status !== "string") throw new Error("Invalid connection state");
  return data as QuickBooksConnectionRecord;
}

export async function getForecastCases(userId:string,baseVersionId:string|null,client:SupabaseClient):Promise<ForecastCasesState>{
  const {data:forecast,error:fError}=await client.from("cash_forecasts").select("id,reporting_currency")
    .eq("user_id",userId).is("archived_at",null).maybeSingle();if(fError)throw fError;
  if(!forecast)return {base:null,currentBaseId:null,bases:[],cases:[]};
  const {data:versions,error:vError}=await client.from("cash_forecast_versions")
    .select("id,version_number,status,start_date,as_of_date,starting_included_cash,minimum_reserve,formula_policy_version")
    .eq("user_id",userId).eq("forecast_id",forecast.id).eq("case_type","base").in("status",["published","superseded"])
    .order("version_number",{ascending:false}).limit(25);if(vError)throw vError;
  const current=versions?.find(v=>v.status==="published")??null;
  const selected=baseVersionId?versions?.find(v=>v.id===baseVersionId):current;
  if(baseVersionId&&!selected)throw Object.assign(new Error("Base not found"),{code:"P0002"});
  const bases=(versions??[]).map(v=>({id:v.id,versionNumber:v.version_number,startDate:v.start_date,status:v.status}));
  if(!selected)return {base:null,currentBaseId:current?.id??null,bases,cases:[]};
  const items:CaseBase["items"]=[];
  for(let offset=0;;offset+=1000){
    const page=await client.from("cash_forecast_items").select("id,description,amount,direction,category,expected_date,status,confidence,source_type,source_updated_at,amount_is_estimated,date_is_estimated")
      .eq("user_id",userId).eq("version_id",selected.id).order("id").range(offset,offset+999);
    if(page.error)throw page.error;
    if(items.length+(page.data?.length??0)>2000)throw Object.assign(new Error("Base exceeds the 2,000-item case limit"),{code:"54000"});
    items.push(...(page.data??[]).map(i=>({id:i.id,description:i.description,amount:i.amount===null?null:Number(i.amount),direction:i.direction,
      category:i.category,expectedDate:i.expected_date,status:i.status,confidence:i.confidence,sourceType:i.source_type,
      sourceUpdatedAt:i.source_updated_at?.slice(0,10)??null,amountIsEstimate:i.amount_is_estimated,dateIsEstimate:i.date_is_estimated})));
    if(!page.data||page.data.length<1000)break;
  }
  const base:CaseBase={id:selected.id,forecastId:forecast.id,versionNumber:selected.version_number,status:selected.status,
    startDate:selected.start_date,asOfDate:selected.as_of_date,startingCash:Number(selected.starting_included_cash),minimumReserve:Number(selected.minimum_reserve),
    currency:forecast.reporting_currency,formulaPolicyVersion:selected.formula_policy_version,
    items:items.sort((a,b)=>(a.expectedDate??"9999-12-31").localeCompare(b.expectedDate??"9999-12-31"))};
  const {data:cases,error:cError}=await client.from("cash_forecast_versions")
    .select("id,version_number,case_type,case_name,status,created_at,case_request_payload")
    .eq("user_id",userId).eq("parent_version_id",base.id).in("case_type",["downside","upside"]).in("status",["published","superseded"])
    .order("version_number",{ascending:false}).limit(50);if(cError)throw cError;
  return {base,currentBaseId:current?.id??null,bases,cases:(cases??[]).filter(c=>c.case_request_payload).map(c=>({
    id:c.id,versionNumber:c.version_number,caseType:c.case_type,name:c.case_name,status:c.status,createdAt:c.created_at,
    assumptions:c.case_request_payload.assumptions,calculation:{baseResult:c.case_request_payload.baseResult,
      caseResult:c.case_request_payload.caseResult,evaluationDate:c.case_request_payload.evaluationDate},
  } as SavedForecastCase))};
}
export async function getForecastCaseReplay(userId:string,requestKey:string,client:SupabaseClient){
  const {data,error}=await client.from("cash_forecast_versions").select("case_request_payload")
    .eq("user_id",userId).eq("case_request_key",requestKey).maybeSingle();if(error)throw error;
  return data?.case_request_payload??null;
}
export async function saveForecastCase(userId:string,input:ReturnType<typeof parseCaseSubmission>,calculation:CaseCalculation,client:SupabaseClient){
  const {data,error}=await client.rpc("save_cash_forecast_case",{p_user_id:userId,p_base_version_id:input.baseVersionId,p_case_type:input.caseType,
    p_name:input.name,p_request_key:input.requestKey,p_assumptions:input.assumptions,p_case_result:calculation.caseResult,
    p_base_result:calculation.baseResult,p_evaluation_date:calculation.evaluationDate});if(error)throw error;
  if(!data||typeof data.version_id!=="string"||!Number.isInteger(data.version_number)||typeof data.replayed!=="boolean")throw new Error("Invalid saved case result");
  return data as {version_id:string;version_number:number;replayed:boolean};
}

export async function getForecastReviewQueue(userId: string, evaluationDate: string, client: SupabaseClient):Promise<{
  weeks:ReviewQueueItem[];hasPublishedPlan:boolean;firstReviewDate?:string;
}> {
  const { data: forecast, error: forecastError } = await client.from("cash_forecasts").select("id")
    .eq("user_id",userId).is("archived_at",null).maybeSingle();
  if (forecastError) throw forecastError;
  if (!forecast) return { weeks:[] as ReviewQueueItem[],hasPublishedPlan:false };
  const { data: versions, error } = await client.from("cash_forecast_versions").select("id,version_number,start_date")
    .eq("user_id",userId).eq("forecast_id",forecast.id).eq("case_type","base")
    .in("status",["published","superseded"]).order("version_number",{ ascending:false }).limit(25);
  if (error) throw error;
  if (!versions?.length) return { weeks:[] as ReviewQueueItem[],hasPublishedPlan:false };
  const reviews: Array<{ id:string;version_id:string;week_start:string;revision:number;coverage:ReviewQueueItem["coverage"] }> = [];
  for (let offset=0; ; offset+=1000) {
    const page = await client.from("cash_forecast_reviews").select("id,version_id,week_start,revision,coverage")
      .eq("user_id",userId).in("version_id",versions.map(v=>v.id)).order("id").range(offset,offset+999);
    if (page.error) throw page.error;
    reviews.push(...(page.data??[]));
    if (!page.data || page.data.length<1000) break;
  }
  const firstStart=versions.map(v=>v.start_date).sort()[0];
  const firstReviewDate=new Date(Date.parse(`${firstStart}T00:00:00Z`)+7*86400000).toISOString().slice(0,10);
  return { weeks:buildReviewQueue(versions,reviews,evaluationDate),hasPublishedPlan:true,firstReviewDate };
}

export async function getOwnerForecastReview(userId:string,versionId:string,weekStart:string,client:SupabaseClient,reviewId?:string):Promise<OwnerReviewState> {
  const evidence = await getForecastReviewEvidence(userId,versionId,weekStart,client);
  let query=client.from("cash_forecast_reviews")
    .select("id,revision,created_at,calculation_result,request_payload,source_snapshot")
    .eq("user_id",userId).eq("version_id",versionId).eq("week_start",weekStart).order("revision",{ascending:false}).limit(1);
  if(reviewId)query=query.eq("id",reviewId);
  const { data: latest, error } = await query.maybeSingle();
  if (error) throw error;
  const history=await client.from("cash_forecast_reviews").select("id,revision,coverage,created_at")
    .eq("user_id",userId).eq("version_id",versionId).eq("week_start",weekStart).order("revision",{ascending:false}).limit(50);
  if(history.error)throw history.error;
  const ids = (events: Array<{id:string}>) => events.map(e=>e.id).sort().join(",");
  return { evidence:ownerReviewEvidence(evidence),history:history.data??[], latest:latest ? {
    id:latest.id,revision:latest.revision,createdAt:latest.created_at,
    evidenceChanged:ids(evidence.actual_events)!==ids(latest.source_snapshot.actual_events??[]),
    evidence:ownerReviewEvidence(latest.source_snapshot),policy:latest.request_payload.policy,activityConfirmed:latest.request_payload.policy.ownerActivityConfirmed===true,
    openingCash:latest.request_payload.opening,closingCash:latest.request_payload.closing,
    allocations:latest.request_payload.allocations,result:latest.calculation_result,
  } : null };
}

export async function getForecastReviewReplay(userId:string,requestKey:string,client:SupabaseClient) {
  const { data,error }=await client.from("cash_forecast_reviews").select("request_payload")
    .eq("user_id",userId).eq("request_key",requestKey).maybeSingle();
  if(error)throw error;
  return data?.request_payload??null;
}

export async function recordManualForecastActual(userId:string,businessId:string,event:Record<string,unknown>,expectedHead:string|null,client:SupabaseClient) {
  const { data,error }=await client.rpc("record_cash_actual_event",{
    p_user_id:userId,p_business_id:businessId,p_event:event,p_expected_head:expectedHead,
  });
  if(error)throw error;
  if(!data || typeof data.event_id!=="string")throw new Error("Invalid recorded cash event result");
  return data as {event_id:string;revision:number;replayed:boolean};
}

export async function getForecastReviewHandoff(userId:string,reviewId:string,client:SupabaseClient) {
  const {data,error}=await client.from("cash_forecast_reviews").select("id,week_start,coverage,calculation_result")
    .eq("user_id",userId).eq("id",reviewId).maybeSingle();
  if(error)throw error;
  return data ? {id:data.id,weekStart:data.week_start,coverage:data.coverage,
    closingCash:data.calculation_result.reconciliation?.actualClosingCash as number|null} : null;
}

/** Internal server adapters. Pass a service client after authenticating the owner.
 * Growth authorization belongs in the E4 route; no public write route exists in E3.
 */
export async function getForecastReviewEvidence(userId: string, versionId: string, weekStart: string,
  client: SupabaseClient): Promise<ForecastReviewEvidence> {
  const { data, error } = await client.rpc("cash_forecast_review_evidence", {
    p_user_id: userId, p_version_id: versionId, p_week_start: weekStart,
  });
  if (error) throw error;
  if (!data || data.version_id !== versionId || data.week_start !== weekStart
    || typeof data.evidence_token !== "string" || !Array.isArray(data.planned_items)
    || !Array.isArray(data.actual_events)) throw new Error("Invalid forecast review evidence");
  return data as ForecastReviewEvidence;
}

export async function saveForecastReview(command: ForecastReviewCommand, client: SupabaseClient): Promise<{
  review_id: string; revision: number; coverage: "complete" | "partial" | "unknown"; replayed: boolean;
}> {
  const { data, error } = await client.rpc("save_cash_forecast_review", {
    p_user_id: command.userId, p_version_id: command.versionId, p_week_start: command.weekStart,
    p_request_key: command.requestKey, p_evidence_token: command.evidenceToken,
    p_allocations: command.allocations, p_policy: command.policy, p_opening_cash: command.openingCash,
    p_closing_cash: command.closingCash, p_result: command.result,
  });
  if (error) throw error;
  if (!data || typeof data.review_id !== "string" || !Number.isInteger(data.revision) || data.revision < 1
    || !["complete", "partial", "unknown"].includes(data.coverage) || typeof data.replayed !== "boolean") {
    throw new Error("Invalid forecast review save result");
  }
  return data;
}

// ─── Business Profile ─────────────────────────────────────────────────────────

/** Returns null if no profile exists yet for this user. */
export async function getBusinessProfile(
  userId: string,
  client: SupabaseClient = supabase
): Promise<BusinessProfile | null> {
  const { data, error } = await client
    .from("business_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Creates or updates the profile for a user.
 * Safe to call on every save — upserts on the unique user_id constraint.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function upsertBusinessProfile(
  userId: string,
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>,
  client: SupabaseClient = supabase,selected:string|null=null
): Promise<BusinessProfile> {
  const { data, error } = await client.rpc("update_owned_business_profile", { p_patch:profile,p_organization_id:selected });
  if (error) monthlyFailure(error);
  if (!data||data.user_id!==userId) throw new MonthlyAuthorityError("unavailable");
  return data;
}

// ─── Financial Months ─────────────────────────────────────────────────────────

/**
 * Returns months ordered newest-first.
 * Default limit matches the dashboard's latest twelve stored months.
 */
export async function getFinancialMonths(
  userId: string,
  limit: number | null = DASHBOARD_MONTH_LIMIT,
  client: SupabaseClient = supabase
): Promise<FinancialMonth[]> {
  let query = client
    .from("financial_months")
    .select("*")
    .eq("user_id", userId)
    .order("month_date", { ascending: false });
  if (limit !== null) query = query.limit(limit);
  const { data, error } = await query;

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates or updates a single month.
 * Upserts on the unique (user_id, month_date) constraint.
 */
export async function upsertFinancialMonth(
  userId: string,
  monthData: Omit<FinancialMonthInsert, "user_id">
): Promise<FinancialMonth> {
  const { data, error } = await supabase
    .from("financial_months")
    .upsert(
      { ...monthData, user_id: userId },
      { onConflict: "user_id,month_date" }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Bulk upsert — used when importing from Excel / CSV.
 * Each row upserts on (user_id, month_date), so re-importing the same
 * file is safe and idempotent.
 */
export async function upsertFinancialMonths(
  userId: string,
  months: Omit<FinancialMonthInsert, "user_id">[],
  client: SupabaseClient = supabase
): Promise<FinancialMonth[]> {
  if (months.length === 0) return [];

  const { data, error } = await client
    .from("financial_months")
    .upsert(
      months.map((m) => ({ ...m, user_id: userId })),
      { onConflict: "user_id,month_date" }
    )
    .select();

  if (error) throw error;
  return data ?? [];
}

// ─── Atomic Financial Imports ─────────────────────────────────────────────────

/**
 * Historical pre-D3 adapter retained for old contract tests. D3 revokes this RPC
 * from every application role; production routes use authenticated monthly
 * authority below. Never retry it or fall back to separate deletes/inserts.
 */
export async function replaceFinancialImport(
  userId: string,
  months: Omit<FinancialMonthInsert, "user_id" | "business_id">[],
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>,
  filename: string,
  serviceClient: SupabaseClient
): Promise<{ replaced: boolean; months_imported: number }> {
  const { data, error } = await serviceClient.rpc("replace_financial_import", {
    p_user_id: userId,
    p_months: months,
    p_profile: importedBusinessDetails(profile),
    p_filename: filename,
  });
  if (error) throw error;
  if (!data || typeof data.replaced !== "boolean" || data.months_imported !== months.length) {
    throw new Error("Invalid financial import result");
  }
  return data;
}

/** Historical pre-D3 adapter; application execution is revoked by D3. */
export async function importFinancialData(
  userId: string,
  months: Omit<FinancialMonthInsert, "user_id" | "business_id">[],
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>,
  filename: string,
  mode: FinancialImportMode,
  serviceClient: SupabaseClient
): Promise<FinancialImportResult> {
  const { data, error } = await serviceClient.rpc("import_financial_data", {
    p_user_id: userId, p_months: months, p_profile: importedBusinessDetails(profile),
    p_filename: filename, p_mode: mode,
  });
  if (error) throw error;
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? { ...data, unchanged: false } : data;
  if (!isFinancialImportResult(result, mode, months.length)) throw new Error("Invalid financial import result");
  return result;
}

export async function getFinancialImportReviewState(userId: string, serviceClient: SupabaseClient): Promise<ImportReviewState> {
  const { data, error } = await serviceClient.rpc("financial_import_review_state", { p_user_id: userId });
  if (error) throw error;
  if (!data || typeof data.state_version !== "string" || !/^[a-f0-9]{32}$/.test(data.state_version) || !isMonthList(data.months)) {
    throw new Error("Invalid financial import review state");
  }
  return data;
}

export async function isV2FinancialImportUnchanged(
  userId: string, months: Omit<FinancialMonthInsert, "user_id" | "business_id">[],
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>, mode: FinancialImportMode,
  serviceClient: SupabaseClient
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc("financial_import_v2_is_unchanged", {
    p_user_id: userId, p_months: months, p_profile: importedBusinessDetails(profile), p_mode: mode,
  });
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Invalid financial import comparison result");
  return data;
}

export async function commitReviewedFinancialImport(
  userId: string, months: Omit<FinancialMonthInsert, "user_id" | "business_id">[],
  profile: Partial<Omit<BusinessProfileInsert, "user_id">>, filename: string,
  mode: FinancialImportMode, expectedState: string, client: SupabaseClient, organizationId:string|null=null, requestId?:string
): Promise<FinancialImportResult> {
  const { data, error } = await client.rpc("owned_monthly_operation", {
    p_operation:"confirm",p_organization_id:organizationId,p_months: months, p_profile: importedBusinessDetails(profile),
    p_filename: filename, p_mode: mode, p_expected_state: expectedState,p_request_id:requestId??crypto.randomUUID(),
  });
  if (error) monthlyFailure(error);
  assertMonthlyAcknowledgment(data,userId,organizationId);
  if (!isFinancialImportResult(data, mode, months.length)) throw new Error("Invalid financial import result");
  return data;
}

/** Authenticated cookie client only; SQL binds the actor and current target authority. */
export async function clearFinancialData(
  userId: string,
  client: SupabaseClient, organizationId:string|null=null, requestId?:string
): Promise<void> {
  const { data, error } = await client.rpc("owned_monthly_operation", {p_operation:"clear",p_organization_id:organizationId,p_request_id:requestId??crypto.randomUUID()});
  if (error) monthlyFailure(error);
  assertMonthlyAcknowledgment(data,userId,organizationId);
  if (!data || data.cleared !== true) throw new MonthlyAuthorityError("unavailable");
}

// ─── Expense Categories ───────────────────────────────────────────────────────

/**
 * Returns expense categories, newest month first.
 * Pass monthDate ("YYYY-MM-DD") to filter to a single month.
 */
export async function getExpenseCategories(
  userId: string,
  monthDate?: string
): Promise<ExpenseCategory[]> {
  let query = supabase
    .from("expense_categories")
    .select("*")
    .eq("user_id", userId)
    .order("month_date", { ascending: false });

  if (monthDate) {
    query = query.eq("month_date", monthDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Upserts expense categories in bulk.
 * Uses replace semantics per month: deletes existing categories for each
 * affected month_date before inserting the new set. This keeps the data
 * consistent when re-importing a month.
 */
export async function upsertExpenseCategories(
  userId: string,
  categories: Omit<ExpenseCategoryInsert, "user_id">[]
): Promise<ExpenseCategory[]> {
  if (categories.length === 0) return [];

  // Collect the distinct month dates touched by this batch
  const monthDates = [...new Set(categories.map((c) => c.month_date))];

  // Delete existing rows for those months (replace semantics)
  const { error: deleteError } = await supabase
    .from("expense_categories")
    .delete()
    .eq("user_id", userId)
    .in("month_date", monthDates);

  if (deleteError) throw deleteError;

  // Insert the new set
  const { data, error } = await supabase
    .from("expense_categories")
    .insert(categories.map((c) => ({ ...c, user_id: userId })))
    .select();

  if (error) throw error;
  return data ?? [];
}

// ─── Data Imports ─────────────────────────────────────────────────────────────

/** Latest successful source import, excluding manual Clear Data audit records. */
export async function getFinancialImportStatus(userId: string, client: SupabaseClient = supabase): Promise<FinancialImportStatus> {
  const {data,error} = await client.from("data_imports")
    .select("created_at,filename")
    .eq("user_id",userId)
    .eq("status","success")
    .in("import_type",["excel","csv","quickbooks"])
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("financialData:importStatus:error",{code:error.code});
    return {available:false,lastImportedAt:null,filename:null};
  }
  return {available:true,lastImportedAt:data?.created_at ?? null,filename:data?.filename ?? null};
}

/** Recent account-scoped source-import audit records. Uploaded files are not retained. */
export async function getRecentFinancialImports(
  userId: string,
  limit = 10,
  client: SupabaseClient = supabase
): Promise<FinancialImportHistory> {
  const {data,error} = await client.from("data_imports")
    .select("id,import_type,filename,months_imported,status,created_at")
    .eq("user_id",userId)
    .in("import_type",["excel","csv","quickbooks"])
    .order("created_at",{ascending:false})
    .limit(limit);
  if (error) {
    console.error("financialData:importHistory:error",{code:error.code});
    return {available:false,imports:[]};
  }
  return {available:true,imports:data ?? []};
}

/**
 * Records a completed (or failed) import run for audit purposes.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function logDataImport(
  userId: string,
  importData: Omit<DataImportInsert, "user_id">,
  client: SupabaseClient = supabase
): Promise<DataImport> {
  const { data, error } = await client.rpc("owned_monthly_operation", {p_operation:"audit_failure",p_filename:importData.filename});
  if (error) monthlyFailure(error);
  if(!data||data.user_id!==userId)throw new MonthlyAuthorityError("unavailable");
  return data;
}

// ─── Composite helpers ────────────────────────────────────────────────────────

/**
 * Returns the existing business profile for the user, or creates a default one
 * if none exists yet. Safe to call on every dashboard load.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function getOrCreateBusinessProfile(
  userId: string,
  client: SupabaseClient = supabase
): Promise<BusinessProfile> {
  const { data: existing, error: fetchError } = await client
    .from("business_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing;

  const { data, error } = await client.rpc("ensure_owned_business_profile");
  if (error) monthlyFailure(error);
  if(!data||data.user_id!==userId)throw new MonthlyAuthorityError("unavailable");
  return data;
}

export interface CashPositionResult {
  /** Closing cash of the most recent month; null means not supplied. */
  cash: number | null;
  /** ISO date of the most recent month, e.g. "2026-04-01". */
  month: string;
  /** Closing cash of the preceding calendar month; null if absent or unknown. */
  previousCash: number | null;
}

/**
 * Returns the cash position from the two most recent financial months.
 * Returns null if no data has been imported yet.
 * Accepts an optional client so server route handlers can pass the server client.
 */
export async function getCurrentCashPosition(
  userId: string,
  client: SupabaseClient = supabase
): Promise<CashPositionResult | null> {
  const { data, error } = await client
    .from("financial_months")
    .select("closing_cash, month_date")
    .eq("user_id", userId)
    .order("month_date", { ascending: false })
    .limit(2);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  return {
    cash: data[0].closing_cash ?? null,
    month: data[0].month_date,
    previousCash: areConsecutiveFinancialMonths(data[0].month_date, data[1]?.month_date)
      ? data[1]?.closing_cash ?? null : null,
  };
}

/** Latest account-scoped available cash evidence for a forward cash forecast. */
export async function getLatestForecastCash(
  userId: string,
  client: SupabaseClient = supabase
): Promise<{ cash: number | null; asOfDate: string } | null> {
  const { data, error } = await client.from("financial_months")
    .select("closing_included_cash,closing_cash,period_cutoff_date,month_date")
    .eq("user_id", userId).order("month_date", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { cash: data.closing_included_cash ?? data.closing_cash ?? null,
    asOfDate: data.period_cutoff_date ?? data.month_date };
}

/** Account-owned immutable weekly plan context for a temporary decision test. */
export async function getPublishedForecastDecisionContext(userId:string,versionId:string,client:SupabaseClient=supabase):Promise<ForecastDecisionContext|null>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionId))return null;
  const {data:version,error:versionError}=await client.from("cash_forecast_versions").select("id,forecast_id,as_of_date,start_date,starting_included_cash,minimum_reserve").eq("id",versionId).eq("user_id",userId).eq("case_type","base").eq("status","published").maybeSingle();
  if(versionError)throw versionError;if(!version)return null;
  const [{data:forecast,error:forecastError},{data:items,error:itemError}]=await Promise.all([
    client.from("cash_forecasts").select("reporting_currency").eq("id",version.forecast_id).eq("user_id",userId).maybeSingle(),
    client.from("cash_forecast_items").select("id,description,amount,direction,category,expected_date,status,confidence,source_type,source_updated_at,amount_is_estimated,date_is_estimated").eq("version_id",version.id).eq("user_id",userId).order("expected_date"),
  ]);
  if(forecastError)throw forecastError;if(itemError)throw itemError;if(!forecast)return null;
  return {versionId:version.id,asOfDate:version.as_of_date,startDate:version.start_date,startingCash:Number(version.starting_included_cash),minimumReserve:Number(version.minimum_reserve),currency:forecast.reporting_currency,items:(items??[]).map(item=>({id:item.id,description:item.description,amount:item.amount===null?null:Number(item.amount),direction:item.direction,category:item.category,expectedDate:item.expected_date,status:item.status,confidence:item.confidence,sourceType:item.source_type,sourceUpdatedAt:item.source_updated_at?.slice(0,10)??null,amountIsEstimate:item.amount_is_estimated,dateIsEstimate:item.date_is_estimated}))};
}

// ─── Dismissed Alerts ─────────────────────────────────────────────────────────

/** Returns all active dismissal records for a user. */
export async function getDismissedAlerts(
  userId: string,
  client: SupabaseClient = supabase
): Promise<DismissedAlert[]> {
  const { data, error } = await client
    .from("dismissed_alerts")
    .select("*")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

/**
 * Upserts a dismissal record.
 * Re-dismissing an already-dismissed alert replaces the previous row
 * (same user_id + alert_code unique index).
 */
export async function dismissAlert(
  userId: string,
  payload: {
    alert_code: string;
    snooze_type: SnoozeType;
    snooze_until: string | null;
    data_version: string | null;
  },
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("dismissed_alerts")
    .upsert(
      {
        user_id: userId,
        alert_code: payload.alert_code,
        snooze_type: payload.snooze_type,
        snooze_until: payload.snooze_until,
        data_version: payload.data_version,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,alert_code" }
    );

  if (error) throw error;
}

/** Removes a dismissal record, making the alert visible again. */
export async function undismissAlert(
  userId: string,
  alertCode: string,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("dismissed_alerts")
    .delete()
    .eq("user_id", userId)
    .eq("alert_code", alertCode);

  if (error) throw error;
}

// ─── Alert Preferences ────────────────────────────────────────────────────────

/**
 * Returns the user's snooze preference from business_profiles.
 * Falls back to '24h' if the column is null.
 */
export async function getAlertPreferences(
  userId: string,
  client: SupabaseClient = supabase
): Promise<UserAlertPreferences> {
  const { data, error } = await client
    .from("business_profiles")
    .select("snooze_duration")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const snooze = (data?.snooze_duration ?? "24h") as SnoozeType;
  return { snooze_duration: snooze };
}

/** Persists the snooze preference to business_profiles. */
export async function updateAlertPreferences(
  userId: string,
  prefs: UserAlertPreferences,
  client: SupabaseClient = supabase
): Promise<void> {
  const { data, error } = await client.rpc("update_owned_profile_preferences", {p_snooze_duration:prefs.snooze_duration});
  if (error) monthlyFailure(error);
  assertMonthlyAcknowledgment(data,userId,null);
}

export async function completeOwnedOnboarding(userId:string,client:SupabaseClient):Promise<void>{
  const {data,error}=await client.rpc("update_owned_profile_preferences",{p_complete_onboarding:true});
  if(error)monthlyFailure(error);
  assertMonthlyAcknowledgment(data,userId,null);
}

// ─── Subscriptions & Usage ────────────────────────────────────────────────────

export async function reserveCheckoutAttempt(
  proposal: Omit<CheckoutAttempt, "created_at" | "session_id">,
  client: SupabaseClient
): Promise<CheckoutAttempt> {
  const { error } = await client.from("subscription_checkout_attempts")
    .upsert(proposal, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw error;
  const { data, error: readError } = await client.from("subscription_checkout_attempts")
    .select("*").eq("user_id", proposal.user_id).single();
  if (readError) throw readError;
  return data as CheckoutAttempt;
}

export async function saveCheckoutAttempt(
  attempt: CheckoutAttempt,
  values: { customer_id?: string; session_id?: string },
  client: SupabaseClient
) {
  const { data, error } = await client.from("subscription_checkout_attempts").update(values)
    .eq("user_id", attempt.user_id).eq("id", attempt.id).select("id").single();
  if (error) throw error;
  if (!data) throw new Error("Checkout attempt changed");
}

export async function releaseCheckoutAttempt(attempt: CheckoutAttempt, client: SupabaseClient) {
  const { error } = await client.from("subscription_checkout_attempts").delete()
    .eq("user_id", attempt.user_id).eq("id", attempt.id);
  if (error) throw error;
}

/** Persist a customer without resetting existing subscription entitlements. */
export async function ensureBillingCustomer(userId: string, customerId: string, client: SupabaseClient): Promise<string> {
  const { error: insertError } = await client.from("subscriptions").upsert({
    user_id: userId, stripe_customer_id: customerId,
    plan: "starter", feature_tier: "starter", status: "active",
  }, { onConflict: "user_id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { error: updateError } = await client.from("subscriptions")
    .update({ stripe_customer_id: customerId }).eq("user_id", userId).is("stripe_customer_id", null);
  if (updateError) throw updateError;
  const { data, error: readError } = await client.from("subscriptions")
    .select("stripe_customer_id").eq("user_id", userId).single();
  if (readError || !data?.stripe_customer_id) throw readError ?? new Error("Missing customer");
  return data.stripe_customer_id;
}

export interface SubscriptionResult {
  plan: Plan;
  feature_tier: FeatureTier;
  status: string;
  billing_period_end: string | null;
  /** @deprecated Founding Member benefits no longer expire. Column retained for schema compatibility only. */
  founding_member_expires_at: string | null;
  founding_member_number: number | null;
  founding_member_is_test: boolean;
  founding_member_cancelled_at: string | null;
  /** Legacy field; no longer grants restoration after the billing cycle ends. */
  founding_member_grace_ends_at: string | null;
}

/**
 * Returns the user's subscription row.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function getSubscription(
  userId: string,
  client: SupabaseClient = supabase
): Promise<SubscriptionResult> {
  const readSubscription = () => client
    .from("subscriptions")
    .select(
      "plan, feature_tier, status, billing_period_end, founding_member_expires_at, founding_member_number, founding_member_is_test, founding_member_cancelled_at, founding_member_grace_ends_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  const { data, error } = await readSubscription();
  if (error) throw error;

  if (!data) {
    // The RPC derives identity from auth.uid() and inserts fixed Starter values.
    // Callers cannot choose a paid tier; a concurrent webhook row always wins.
    const { error: initializeError } = await client.rpc("initialize_subscription");
    if (initializeError) throw initializeError;

    // Return the stored row, which may belong to the concurrent webhook.
    const { data: initialized, error: readError } = await readSubscription();
    if (readError) throw readError;
    if (!initialized) throw new Error("Subscription unavailable after initialization");
    return initialized as SubscriptionResult;
  }

  return data as SubscriptionResult;
}

/**
 * True when the user has completed a plan checkout (or was granted a paid plan).
 *
 * `status` alone is not enough: getSubscription() and the checkout route both
 * insert a default `starter / active` row for users who have never paid. A
 * genuine subscription either carries a Stripe subscription ID (set by the
 * webhook) or is on a non-starter plan (e.g. set manually via SQL).
 *
 * Read-only — never inserts a row. Safe to call from proxy.ts.
 */
export async function hasPaidSubscription(
  userId: string,
  client: SupabaseClient = supabase
): Promise<boolean> {
  const { data, error } = await client
    .from("subscriptions")
    .select("plan, status, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  const isActive = data.status === "active" || data.status === "pending_cancellation";
  return isActive && (!!data.stripe_subscription_id || data.plan !== "starter");
}

export interface BillingDetails {
  plan: Plan;
  feature_tier: FeatureTier;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  cancelled_at: string | null;
  founding_member_number: number | null;
  founding_member_is_test: boolean;
  /** @deprecated Founding Member benefits no longer expire. Column retained for schema compatibility only. */
  founding_member_expires_at: string | null;
  founding_member_cancelled_at: string | null;
  /** Legacy field; no longer grants restoration after the billing cycle ends. */
  founding_member_grace_ends_at: string | null;
}

export async function getBillingDetails(
  userId: string,
  client: SupabaseClient = supabase
): Promise<BillingDetails> {
  const { data, error } = await client
    .from("subscriptions")
    .select(
      "plan, feature_tier, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, billing_period_start, billing_period_end, cancelled_at, founding_member_number, founding_member_is_test, founding_member_expires_at, founding_member_cancelled_at, founding_member_grace_ends_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      plan: "starter",
      feature_tier: "starter",
      status: "active",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      billing_period_start: null,
      billing_period_end: null,
      cancelled_at: null,
      founding_member_number: null,
      founding_member_is_test: false,
      founding_member_expires_at: null,
      founding_member_cancelled_at: null,
      founding_member_grace_ends_at: null,
    };
  }
  return data as BillingDetails;
}

const NOTIFICATION_PLAN_FEATURES = ["tier_growth", "tier_advisory"] as const;
export type NotificationPlanFeature = (typeof NOTIFICATION_PLAN_FEATURES)[number];

/** Reads persisted plan-interest state for one authenticated account. */
export async function getPlanNotificationFeatures(
  userId: string,
  client: SupabaseClient
): Promise<NotificationPlanFeature[]> {
  const { data, error } = await client
    .from("notify_me")
    .select("feature")
    .eq("user_id", userId)
    .in("feature", [...NOTIFICATION_PLAN_FEATURES]);

  if (error) throw error;
  return (data ?? [])
    .map(row => row.feature)
    .filter((feature): feature is NotificationPlanFeature =>
      NOTIFICATION_PLAN_FEATURES.includes(feature as NotificationPlanFeature)
    );
}

/**
 * Counts customer identities, including cancelled/deleted accounts; excludes tests.
 * Cancellation never releases a spot. Audited owner corrections are explicit exceptions.
 */
export async function getClaimedFoundingMemberCount(
  client: SupabaseClient
): Promise<number> {
  const { count, error } = await client
    .from("founding_member_spots")
    .select("founding_member_number", { count: "exact", head: true })
    .eq("is_test", false);
  if (error) throw error;
  return count ?? 0;
}

/** Lowest unissued customer number; cancelled identities remain in the registry. */
export async function getAvailableFoundingMemberNumber(
  client: SupabaseClient
): Promise<number | null> {
  const { data, error } = await client
    .from("founding_member_spots")
    .select("founding_member_number")
    .eq("is_test", false);
  if (error) throw error;
  const issued = new Set((data ?? []).map(row => row.founding_member_number));
  for (let number = 1; number <= FOUNDING_MEMBER_SPOTS; number++) {
    if (!issued.has(number)) return number;
  }
  return null;
}

export interface UsageResult {
  count: number;
  usage_limit: number | null;
  warning_sent_at: string | null;
}

/**
 * Returns usage for a metric in the current billing period.
 * Always call with the server client from utils/supabase/server.ts.
 */
export async function getUsage(
  userId: string,
  metric: string,
  periodStart: Date,
  client: SupabaseClient = supabase
): Promise<UsageResult> {
  const { data, error } = await client
    .from("usage_tracking")
    .select("count, usage_limit, warning_sent_at")
    .eq("user_id", userId)
    .eq("metric", metric)
    .eq("period_start", periodStart.toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!data) return { count: 0, usage_limit: null, warning_sent_at: null };

  return {
    count: data.count,
    usage_limit: data.usage_limit,
    warning_sent_at: data.warning_sent_at,
  };
}

export interface UsageConsumptionResult extends UsageResult {
  allowed: boolean;
  throttled: boolean;
}

/**
 * Atomically decides and consumes one usage unit. The supplied client must be
 * the server-only service client; browser/session roles cannot execute the RPC.
 */
export async function consumeUsage(
  userId: string,
  metric: string,
  periodStart: Date,
  periodEnd: Date,
  usageLimit: number | null,
  allowOverage: boolean,
  client: SupabaseClient = supabase
): Promise<UsageConsumptionResult> {
  if (usageLimit === null) {
    return { allowed: true, throttled: false, count: 0, usage_limit: null, warning_sent_at: null };
  }
  const { data, error } = await client.rpc("consume_usage", {
    p_user_id: userId,
    p_metric: metric,
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
    p_usage_limit: usageLimit,
    p_allow_overage: allowOverage,
  });

  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid usage consumption result");
  const value = data as Record<string, unknown>;
  if (typeof value.allowed !== "boolean" || typeof value.throttled !== "boolean"
    || !Number.isSafeInteger(value.count) || (value.count as number) < 0
    || value.usage_limit !== usageLimit
    || (value.warning_sent_at !== null && typeof value.warning_sent_at !== "string")) {
    throw new Error("Invalid usage consumption result");
  }
  return {
    allowed: value.allowed,
    throttled: value.throttled,
    count: value.count as number,
    usage_limit: value.usage_limit as number,
    warning_sent_at: value.warning_sent_at as string | null,
  };
}

/**
 * Records that a usage warning email has been sent for this period.
 * Always call with a trusted server-side client. Usage consumption itself
 * requires the service-role client because browser/session roles cannot run it.
 */
export async function markWarningSent(
  userId: string,
  metric: string,
  periodStart: Date,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("usage_tracking")
    .update({ warning_sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("metric", metric)
    .eq("period_start", periodStart.toISOString());

  if (error) throw error;
}

/**
 * Returns the start of the current billing period (midnight UTC) based on
 * the day-of-month the subscription was originally created.
 *
 * Example: created on the 14th, today is the 20th of next month
 * → period start is the 14th of this month at 00:00 UTC.
 */
export function getBillingPeriodStart(subscriptionCreatedAt: Date): Date {
  const now = new Date();
  const createdDay = subscriptionCreatedAt.getUTCDate();

  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth();

  // Clamp to the last day of the month in case the subscription day doesn't exist
  const daysInThisMonth = new Date(
    Date.UTC(thisYear, thisMonth + 1, 0)
  ).getUTCDate();
  const billingDayThisMonth = Math.min(createdDay, daysInThisMonth);

  if (now.getUTCDate() >= billingDayThisMonth) {
    return new Date(Date.UTC(thisYear, thisMonth, billingDayThisMonth));
  }

  // Period started last month
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
  const daysInLastMonth = new Date(
    Date.UTC(lastMonthYear, lastMonth + 1, 0)
  ).getUTCDate();
  const billingDayLastMonth = Math.min(createdDay, daysInLastMonth);

  return new Date(Date.UTC(lastMonthYear, lastMonth, billingDayLastMonth));
}

// ─── Action Tracker ───────────────────────────────────────────────────────────


/**
 * Returns the count of active (non-completed) actions for a user.
 * Used to enforce per-tier limits before creating a new action.
 * Always call with the server client.
 */
export async function getActiveActionCount(
  userId: string,
  client: SupabaseClient = supabase
): Promise<number> {
  const { data, error } = await client.rpc("get_active_action_count", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Returns all actions for a user, newest first.
 * Pass status to filter (e.g. fetch only active actions for the panel).
 */
export async function getActions(
  userId: string,
  options: { status?: ActionStatus | ActionStatus[] } = {},
  client: SupabaseClient = supabase
): Promise<Action[]> {
  let query = client
    .from("actions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options.status) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status];
    query = query.in("status", statuses);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Returns a single action owned by the user, or null if it doesn't exist.
 */
export async function getAction(
  userId: string,
  actionId: string,
  client: SupabaseClient = supabase
): Promise<Action | null> {
  const { data, error } = await client
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Creates a new action.
 * Callers preflight the tier limit; the database capacity trigger is authoritative
 * when concurrent creates/reopens compete for the remaining active slots.
 */
export async function createAction(
  userId: string,
  action: Omit<ActionInsert, "user_id">,
  client: SupabaseClient = supabase
): Promise<Action> {
  const { data, error } = await client
    .from("actions")
    .insert({ ...action, user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Partially updates an action.
 * Locks/updates the action and writes status history in one database transaction.
 * Always call with the server client.
 */
export async function updateAction(
  userId: string,
  actionId: string,
  updates: ActionUpdate,
  options: { auditNote?: string } = {},
  client: SupabaseClient = supabase
): Promise<Action> {
  const { data, error } = await client.rpc("update_action_with_audit", {
    p_user_id: userId,
    p_action_id: actionId,
    p_updates: updates,
    p_audit_note: options.auditNote ?? null,
  });
  if (error) throw error;
  if (!data || data.id !== actionId || data.user_id !== userId) {
    throw new Error("Could not confirm action update");
  }
  return data;
}

/**
 * Deletes an action. Only the owning user can delete their own actions (enforced by RLS).
 * Cascade on action_audit_log means history is also removed.
 */
export async function deleteAction(
  userId: string,
  actionId: string,
  client: SupabaseClient = supabase
): Promise<void> {
  const { error } = await client
    .from("actions")
    .delete()
    .eq("id", actionId)
    .eq("user_id", userId);

  if (error) throw error;
}

/**
 * Returns the audit log for a specific action, newest entry first.
 */
export async function getActionAuditLog(
  userId: string,
  actionId: string,
  client: SupabaseClient = supabase
): Promise<ActionAuditLog[]> {
  const { data, error } = await client
    .from("action_audit_log")
    .select("*")
    .eq("action_id", actionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
