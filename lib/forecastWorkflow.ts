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

export function forecastCategoriesFor(direction: ForecastDirection) {
  return FORECAST_CATEGORIES.filter(category=>category.direction===direction);
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
