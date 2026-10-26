import type { ForecastCashItem, ForecastCategory, ForecastDirection } from "./cashForecast";

export const FORECAST_FRESHNESS_POLICY = { maxStartingCashAgeDays: 3, maxItemSourceAgeDays: 7 } as const;
export const FORECAST_CATEGORIES: Array<{ value: ForecastCategory; label: string; direction: ForecastDirection }> = [
  { value: "customer_receipt", label: "Customer receipt", direction: "inflow" },
  { value: "operating_vendor_payment", label: "Vendor or operating payment", direction: "outflow" },
  { value: "payroll", label: "Payroll", direction: "outflow" },
  { value: "tax", label: "Tax payment", direction: "outflow" },
  { value: "debt_principal", label: "Debt principal", direction: "outflow" },
  { value: "debt_interest", label: "Debt interest", direction: "outflow" },
  { value: "owner_distribution", label: "Owner distribution", direction: "outflow" },
  { value: "asset_purchase", label: "Asset purchase", direction: "outflow" },
  { value: "asset_proceeds", label: "Asset sale proceeds", direction: "inflow" },
  { value: "new_debt", label: "New loan proceeds", direction: "inflow" },
  { value: "owner_equity_funding", label: "Owner or equity funding", direction: "inflow" },
  { value: "other_cash_in", label: "Other cash in", direction: "inflow" },
  { value: "other_cash_out", label: "Other cash out", direction: "outflow" },
];

export const FORECAST_DIRECTION_LABELS: Record<ForecastDirection,{ title:string; description:string }> = {
  inflow: { title:"Cash expected in", description:"Customer payments, financing, asset sales, or other cash you expect to receive." },
  outflow: { title:"Cash expected out", description:"Payroll, bills, taxes, debt payments, purchases, or other cash you expect to pay." },
};

export const FORECAST_CONFIDENCE_OPTIONS: Array<{ value: ForecastCashItem["confidence"]; label: string; summary: string }> = [
  { value:"confirmed", label:"Confirmed by a document or person", summary:"Confirmed" },
  { value:"high", label:"Expected based on good evidence", summary:"Expected" },
  { value:"medium", label:"Best current estimate", summary:"Estimated" },
  { value:"low", label:"Not yet confirmed", summary:"Needs confirmation" },
  { value:"unknown", label:"I cannot confirm this yet", summary:"Needs confirmation" },
];

export function forecastConfidenceSummary(confidence: ForecastCashItem["confidence"]): string {
  return FORECAST_CONFIDENCE_OPTIONS.find(option=>option.value===confidence)?.summary??"Needs confirmation";
}

export function forecastConfidenceExplanation(confidence: ForecastCashItem["confidence"]): string {
  switch (confidence) {
    case "confirmed": return "Choose this when a document or person confirms both the amount and date.";
    case "high": return "Choose this when you have good evidence, but the amount or date could still move.";
    case "medium": return "Choose this for your best current estimate when some details may change.";
    case "low": return "Choose this for an early estimate. It will stay marked Needs confirmation.";
    default: return "Choose this when you cannot support the amount or date yet. It will stay marked Needs confirmation after you save it.";
  }
}

export function forecastSaferTiming(expectedDate: string, direction: ForecastDirection): { date: string; label: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) return null;
  const date = new Date(`${expectedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const days = direction==="inflow"?14:-7;
  date.setUTCDate(date.getUTCDate()+days);
  return {date:date.toISOString().slice(0,10),label:direction==="inflow"?"Plan for this cash to arrive 2 weeks later":"Plan for this cash to leave 1 week earlier"};
}

export type ForecastItemOwnerGuidance = {
  check: string[];
  ifUnconfirmed: string;
};

export function forecastItemOwnerGuidance(category: ForecastCategory, direction: ForecastDirection): ForecastItemOwnerGuidance {
  switch (category) {
    case "customer_receipt": return {check:["Check the invoice amount and due date.","Confirm when the customer expects to pay.","Consider whether this customer usually pays late."],ifUnconfirmed:"Keep it as an estimate and test what happens if the payment arrives later."};
    case "operating_vendor_payment": return {check:["Check the latest bill or contract.","Confirm the due date and payment terms.","Ask the vendor whether the timing can move if needed."],ifUnconfirmed:"Keep it as an estimate and plan for the payment to leave sooner."};
    case "payroll": return {check:["Check the payroll register or provider schedule.","Use the date the money will leave the account.","Include payroll taxes and fees if they are withdrawn separately."],ifUnconfirmed:"Use the higher reasonable amount and earlier likely withdrawal date."};
    case "tax": return {check:["Check the filing estimate or payment notice.","Confirm the due date with your accountant, payroll provider, or tax calendar."],ifUnconfirmed:"Use the higher reasonable estimate and do not move the date later without support."};
    case "debt_principal":
    case "debt_interest": return {check:["Check the lender statement or payment schedule.","Confirm the withdrawal date and whether it uses automatic payment."],ifUnconfirmed:"Use the scheduled payment date and the higher reasonable amount."};
    case "new_debt":
    case "owner_equity_funding": return {check:["Confirm that the funding is committed, not only discussed.","Check any conditions that must be met before funds arrive.","Confirm the expected deposit date."],ifUnconfirmed:"Keep it as an estimate and test a later funding date before relying on it."};
    case "asset_proceeds": return {check:["Check the signed sale agreement or buyer confirmation.","Confirm the amount you will receive after fees and the expected closing date."],ifUnconfirmed:"Keep it as an estimate and test a later receipt date."};
    case "owner_distribution": return {check:["Confirm the amount and date with the owner approving the distribution.","Check that the payment can wait if cash becomes tight."],ifUnconfirmed:"Treat it as planned cash out and consider moving it later."};
    case "asset_purchase": return {check:["Check the purchase order, agreement, or vendor quote.","Confirm the deposit and final payment dates."],ifUnconfirmed:"Use the earlier likely date and higher reasonable amount."};
    default: return direction==="inflow"
      ? {check:["Identify who or what confirms the amount.","Confirm when the money should reach the account."],ifUnconfirmed:"Keep it as an estimate and test a later receipt date."}
      : {check:["Find the bill, agreement, or person who can confirm the amount.","Confirm when the money will leave the account."],ifUnconfirmed:"Keep it as an estimate and plan for the money to leave sooner."};
  }
}

export function forecastCategoriesFor(direction: ForecastDirection) {
  return FORECAST_CATEGORIES.filter(category=>category.direction===direction);
}

export function forecastItemReviewReasons(
  item: ForecastCashItem,
  evaluationDate: string,
  maxSourceAgeDays = FORECAST_FRESHNESS_POLICY.maxItemSourceAgeDays
): string[] {
  const reasons: string[] = [];
  if (item.amount === null || item.expectedDate === null) reasons.push("Amount or date needed");
  if (item.confidence === "low" || item.confidence === "unknown") reasons.push("Amount or date needs confirmation");
  const sourceDate = item.sourceUpdatedAt && /^\d{4}-\d{2}-\d{2}$/.test(item.sourceUpdatedAt)
    ? Date.parse(`${item.sourceUpdatedAt}T00:00:00Z`) : Number.NaN;
  const evaluated = /^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)
    ? Date.parse(`${evaluationDate}T00:00:00Z`) : Number.NaN;
  const ageDays = Number.isFinite(sourceDate) && Number.isFinite(evaluated)
    ? Math.floor((evaluated - sourceDate) / 86_400_000) : null;
  if (ageDays === null || ageDays < 0 || ageDays > maxSourceAgeDays) reasons.push("Information needs refreshing");
  return reasons;
}

export function forecastSetupProgress(input:{ hasVersion:boolean; itemCount:number; valid:boolean; warningCount:number }) {
  if (!input.hasVersion) return { step:1, label:"Confirm your starting cash", readyToPublish:false } as const;
  if (input.itemCount===0) return { step:2, label:"Add the cash you expect", readyToPublish:false } as const;
  return {
    step:3,
    label:input.valid&&input.warningCount===0?"Review and publish":"Review items that need attention",
    readyToPublish:input.valid,
  } as const;
}

export function parseForecastItem(body: unknown): { ok: true; value: Omit<ForecastCashItem,"id"|"sourceType"|"sourceUpdatedAt"> & { id?: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok:false,error:"Invalid cash item" };
  const v=body as Record<string,unknown>;
  const category=FORECAST_CATEGORIES.find(c=>c.value===v.category);
  if (!category) return { ok:false,error:"Choose a cash category" };
  const description=typeof v.description==="string"?v.description.trim():"";
  if (!description || description.length>500) return { ok:false,error:"Enter a description of 500 characters or fewer" };
  if (v.amount==="" || v.amount===null || v.amount===undefined) return { ok:false,error:"Enter an amount, including zero when confirmed" };
  const amount=typeof v.amount==="number"?v.amount:Number(v.amount);
  if (!Number.isFinite(amount)||amount<0) return { ok:false,error:"Enter a valid nonnegative amount" };
  const expectedDate=typeof v.expectedDate==="string"?v.expectedDate:"";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)||Number.isNaN(Date.parse(expectedDate))) return { ok:false,error:"Enter an expected cash date" };
  const confidence=["confirmed","high","medium","low","unknown"].includes(String(v.confidence))?v.confidence as ForecastCashItem["confidence"]:"unknown";
  const id=typeof v.id==="string"&&/^[0-9a-f-]{36}$/i.test(v.id)?v.id:undefined;
  return { ok:true,value:{ id,description,amount,direction:category.direction,category:category.value,expectedDate,
    status:"expected",confidence,amountIsEstimate:v.amountIsEstimate===true,dateIsEstimate:v.dateIsEstimate===true } };
}

export function todayIso(): string { return new Date().toISOString().slice(0,10); }

export type ForecastDraftDiscardResult =
  | { discarded: true; reason: null }
  | { discarded: false; reason: "changed" | "linked_action" | "linked_version" };

export function parseForecastDraftDiscardResult(value: unknown): ForecastDraftDiscardResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.discarded === true && result.reason === null) return { discarded: true, reason: null };
  if (result.discarded === false
    && (result.reason === "changed" || result.reason === "linked_action" || result.reason === "linked_version")) {
    return { discarded: false, reason: result.reason };
  }
  return null;
}
