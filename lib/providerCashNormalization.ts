import { createHash } from "node:crypto";
import type { FinancialMonthInsert } from "./types";

export const PROVIDER_CASH_POLICY_VERSION="provider-cash-1";
export const CASH_BRIDGE_FIELDS=["cash_collected_from_customers","operating_cash_paid","owner_draws_paid","debt_principal_paid",
  "debt_interest_paid","investing_cash_paid","investing_cash_received","debt_funding_received","owner_funding_received",
  "other_cash_inflows","other_cash_outflows"] as const;
export type CashBridgeField=typeof CASH_BRIDGE_FIELDS[number];
const INFLOWS=new Set<CashBridgeField>(["cash_collected_from_customers","investing_cash_received","debt_funding_received","owner_funding_received","other_cash_inflows"]);
const MAX_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const ZERO=BigInt(0);
export type ProviderScope={businessId:string;connectionId:string;companyId:string;generation:string;reportingCurrency:string};
export type ProviderCashBinding=ProviderScope & {provider:"quickbooks";status:"connected"|"disconnected";currencyPrecision:number;
  cashAccountIds:string[];cashPerimeterConfirmed:boolean};
export type ProviderCashAccount={accountId:string;reportingCurrency:string;openingDate:string;closingDate:string;
  openingBalance:string|null;closingBalance:string|null};
/** Canonical adapter facts, not raw QBO invoices/reports/webhook payloads. */
export type ProviderCashMovement={sourceEventId:string;sourceRevision:string;kind:"cash_movement"|"transfer"|"non_cash_document";
  status:"posted"|"pending"|"voided"|"deleted";cashDate:string|null;amount:string|null;reportingCurrency:string;
  fromAccountId:string|null;toAccountId:string|null;classification:CashBridgeField|null};
export type ProviderCashBatch={scope:ProviderScope;sourceBasis:"direct_cash_ledger";batchId:string;monthDate:string;
  windowStart:string;windowEnd:string;retrievedAt:string;retrievalStatus:"complete"|"partial"|"failed";
  paginationComplete:boolean;periodCoverageConfirmed:boolean;accounts:ProviderCashAccount[];movements:ProviderCashMovement[];
  closingUnavailableCash:string|null;unavailableCashConfirmed:boolean};
export type ProviderCashIssue={code:"invalid_input"|"disconnected"|"scope_mismatch"|"stale_generation"|"incomplete_retrieval"
  |"invalid_period"|"stale_retrieval"|"perimeter_mismatch"|"missing_balance"|"invalid_money"|"currency_mismatch"
  |"duplicate_event"|"invalid_event"|"unresolved_classification"|"unreconciled_account"|"unavailable_cash_invalid";
  message:string;accountId?:string;sourceEventId?:string};
export type NormalizedProviderMonth=Omit<FinancialMonthInsert,"user_id"|"business_id"> & Record<CashBridgeField,number> & {
  data_contract_version:2;source_type:"quickbooks";accounting_basis:"cash";period_status:"complete";period_cutoff_date:null;
  opening_included_cash:number;closing_included_cash:number;closing_unavailable_cash:number};
export type ProviderMonthProvenance={policyVersion:typeof PROVIDER_CASH_POLICY_VERSION;scope:ProviderScope;currencyPrecision:number;
  monthDate:string;cashAccountIds:string[];cashPerimeterFingerprint:string;evidenceFingerprint:string;retrievedAt:string;batchId:string};
export type ProviderCashNormalization={valid:boolean;month:NormalizedProviderMonth|null;provenance:ProviderMonthProvenance|null;
  issues:ProviderCashIssue[];reconciliation:Array<{accountId:string;difference:number}>;
  counts:{cashMovements:number;internalTransfers:number;outsidePerimeter:number;nonCashDocuments:number}};

function id(value:unknown):value is string{return typeof value==="string"&&value.length>0&&value.length<=500&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);}
function date(value:unknown):value is string{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const ms=Date.parse(`${value}T00:00:00Z`);return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function timestamp(value:unknown):number|null{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)||!date(value.slice(0,10)))return null;
  const ms=Date.parse(value);return Number.isFinite(ms)?ms:null;
}
function minor(value:unknown,precision:number,allowNegative=false):bigint|null{
  if(typeof value!=="string"||value.length>64||!new RegExp(`^${allowNegative?"-?":""}\\d+(?:\\.\\d{1,${Math.max(1,precision)}})?$`).test(value)
    ||(precision===0&&value.includes(".")))return null;
  const negative=value.startsWith("-"),[whole,fraction=""]=value.replace(/^-/ ,"").split(".");
  const units=BigInt(whole)*BigInt(10**precision)+BigInt((fraction+"0".repeat(precision)).slice(0,precision)||"0");
  return units>MAX_MINOR?null:negative?-units:units;
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function sameProviderScope(a:ProviderScope,b:ProviderScope):boolean{
  return ["businessId","connectionId","companyId","generation","reportingCurrency"].every(key=>a[key as keyof ProviderScope]===b[key as keyof ProviderScope]);
}

/** Pure pre-publication projection. It neither authorizes callers nor writes data.
 * The future atomic writer must recheck ownership, generation and source policy.
 */
export function normalizeProviderCashMonth(binding:ProviderCashBinding,batch:ProviderCashBatch,
  expectedScope:ProviderScope,evaluation:{date:string;timestamp:string}):ProviderCashNormalization{
  const issues:ProviderCashIssue[]=[],reconciliation:ProviderCashNormalization["reconciliation"]=[];
  const counts={cashMovements:0,internalTransfers:0,outsidePerimeter:0,nonCashDocuments:0};
  const add=(code:ProviderCashIssue["code"],message:string,extra:Partial<Pick<ProviderCashIssue,"accountId"|"sourceEventId">>={})=>issues.push({code,message,...extra});
  const blocked=():ProviderCashNormalization=>({valid:false,month:null,provenance:null,issues,reconciliation,counts});
  const now=timestamp(evaluation?.timestamp);
  if(!binding||!batch||!expectedScope||!date(evaluation?.date)||now===null||binding.provider!=="quickbooks"
    ||!["businessId","connectionId","companyId","generation"].every(k=>id(binding[k as keyof ProviderScope])&&id(expectedScope[k as keyof ProviderScope]))
    ||!/^([A-Z]{3})$/.test(binding.reportingCurrency)||!Number.isInteger(binding.currencyPrecision)||binding.currencyPrecision<0||binding.currencyPrecision>4
    ||!Array.isArray(binding.cashAccountIds)||!binding.cashAccountIds.length||binding.cashAccountIds.length>100
    ||!binding.cashAccountIds.every(id)||new Set(binding.cashAccountIds).size!==binding.cashAccountIds.length
    ||!id(batch.batchId)||!Array.isArray(batch.accounts)||batch.accounts.length>100||!Array.isArray(batch.movements)||batch.movements.length>10000){
    add("invalid_input","Source identity, dates, currency, precision and bounded account/movement lists are required.");return blocked();
  }
  if(binding.status!=="connected")add("disconnected","Disconnected sources cannot normalize queued work for publication.");
  if(!batch.scope||!sameProviderScope(binding,expectedScope)||!sameProviderScope(binding,batch.scope)){
    const generationChanged=expectedScope.generation!==binding.generation||batch.scope?.generation!==binding.generation;
    add(generationChanged?"stale_generation":"scope_mismatch",generationChanged?"The sync generation changed; fetch fresh evidence.":"The company, connection, workspace or currency does not match the trusted scope.");
  }
  if(batch.sourceBasis!=="direct_cash_ledger")add("invalid_input","Report totals and accrual documents are not direct cash movement evidence.");
  if(batch.retrievalStatus!=="complete"||batch.paginationComplete!==true||batch.periodCoverageConfirmed!==true)
    add("incomplete_retrieval","Every selected account and source page must be complete for the requested period.");
  if(binding.cashPerimeterConfirmed!==true)add("perimeter_mismatch","Confirm the included cash accounts before normalization.");
  if(!date(batch.monthDate)||!/^\d{4}-\d{2}-01$/.test(batch.monthDate))add("invalid_period","Choose a valid calendar month.");
  else{
    const end=new Date(`${batch.monthDate}T00:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
    if(batch.windowStart!==batch.monthDate||batch.windowEnd!==end.toISOString().slice(0,10)||batch.windowEnd>=evaluation.date)
      add("invalid_period","The initial provider boundary requires a full month that ended before the company’s evaluation date.");
  }
  const retrieved=timestamp(batch.retrievedAt);
  if(retrieved===null||retrieved>now||now-retrieved>3600000)add("stale_retrieval","Fetch complete evidence within the last hour; future retrieval timestamps are invalid.");
  if(issues.length)return blocked();
  const precision=binding.currencyPrecision,scale=10**precision,selected=new Set(binding.cashAccountIds);
  const balances=new Map<string,{opening:bigint;closing:bigint}>(),net=new Map(binding.cashAccountIds.map(a=>[a,ZERO]));
  for(const account of batch.accounts){
    if(!account||!selected.has(account.accountId)||balances.has(account.accountId)){
      add("perimeter_mismatch","Account balances must match the selected perimeter exactly, without duplicates.");continue;}
    if(account.reportingCurrency!==binding.reportingCurrency)add("currency_mismatch","Cash account currency must match the reporting currency.",{accountId:account.accountId});
    if(account.openingDate!==batch.windowStart||account.closingDate!==batch.windowEnd)add("invalid_period","Account balances must cover the same opening and closing dates.",{accountId:account.accountId});
    const opening=minor(account.openingBalance,precision,true),closing=minor(account.closingBalance,precision,true);
    if(opening===null||closing===null)add(account.openingBalance===null||account.closingBalance===null?"missing_balance":"invalid_money","Both account balances must be known decimal amounts at the reporting precision.",{accountId:account.accountId});
    else balances.set(account.accountId,{opening,closing});
  }
  if(balances.size!==selected.size)add("perimeter_mismatch","A selected cash account is missing usable balance evidence.");
  const unavailable=minor(batch.closingUnavailableCash,precision);
  if(unavailable===null||batch.unavailableCashConfirmed!==true)add("unavailable_cash_invalid","Unavailable closing cash needs an explicit confirmed amount, including zero.");
  if(issues.length)return blocked();
  const totals=Object.fromEntries(CASH_BRIDGE_FIELDS.map(f=>[f,ZERO])) as Record<CashBridgeField,bigint>;
  const seen=new Set<string>(),evidence:Array<Record<string,string|null>>=[];
  for(const movement of batch.movements){
    if(!movement||!id(movement.sourceEventId)||!id(movement.sourceRevision)){add("invalid_event","Every source event needs stable qualified identity and revision.");continue;}
    const extra={sourceEventId:movement.sourceEventId};
    if(seen.has(movement.sourceEventId)){add("duplicate_event","Duplicate source events must be resolved before normalization.",extra);continue;}seen.add(movement.sourceEventId);
    if(movement.kind==="non_cash_document"){
      if(movement.fromAccountId!==null||movement.toAccountId!==null||movement.classification!==null)add("invalid_event","A non-cash document cannot carry cash-account legs or a cash classification.",extra);
      else counts.nonCashDocuments++;continue;
    }
    if(!["cash_movement","transfer"].includes(movement.kind)||movement.status!=="posted"||!date(movement.cashDate)
      ||movement.cashDate<batch.windowStart||movement.cashDate>batch.windowEnd
      ||(movement.fromAccountId!==null&&!id(movement.fromAccountId))||(movement.toAccountId!==null&&!id(movement.toAccountId))
      ||(!movement.fromAccountId&&!movement.toAccountId)||movement.fromAccountId===movement.toAccountId){
      add("invalid_event","Only posted, dated, unambiguous cash movements from this month are accepted. Refetch periods affected by tombstones or pending data.",extra);continue;
    }
    const amount=minor(movement.amount,precision);
    if(amount===null){add("invalid_money","Cash movements require nonnegative decimal amounts at the reporting precision.",extra);continue;}
    if(movement.reportingCurrency!==binding.reportingCurrency){add("currency_mismatch","Mixed-currency cash events require a separate reviewed conversion policy.",extra);continue;}
    const from=movement.fromAccountId!==null&&selected.has(movement.fromAccountId),to=movement.toAccountId!==null&&selected.has(movement.toAccountId);
    if(!from&&!to){counts.outsidePerimeter++;continue;}
    if(movement.kind==="transfer"&&movement.classification!==null || movement.kind==="cash_movement"&&from&&to){
      add("unresolved_classification","Internal transfers must be identified explicitly and cannot be classified as collections or spending.",extra);continue;}
    let classification:CashBridgeField|null=movement.classification;
    if(movement.kind==="transfer"){
      if(from&&to){counts.internalTransfers++;classification=null;}else classification=to?"other_cash_inflows":"other_cash_outflows";
    }else if(!classification||!CASH_BRIDGE_FIELDS.includes(classification)||INFLOWS.has(classification)!==to){
      add("unresolved_classification","Confirm a cash-bridge classification that agrees with the perimeter direction.",extra);continue;
    }
    if(from)net.set(movement.fromAccountId!,net.get(movement.fromAccountId!)!-amount);
    if(to)net.set(movement.toAccountId!,net.get(movement.toAccountId!)!+amount);
    if(classification){totals[classification]+=amount;counts.cashMovements++;}
    evidence.push({id:movement.sourceEventId,revision:movement.sourceRevision,date:movement.cashDate,amountMinor:amount.toString(),
      kind:movement.kind,from:movement.fromAccountId,to:movement.toAccountId,classification});
  }
  if(issues.length)return blocked();
  let opening=ZERO,closing=ZERO;
  for(const [accountId,balance] of balances){
    const difference=balance.closing-balance.opening-net.get(accountId)!;
    reconciliation.push({accountId,difference:Number(difference)/scale});opening+=balance.opening;closing+=balance.closing;
    if(difference!==ZERO)add("unreconciled_account","Opening cash and recorded movements do not explain this account’s closing balance.",{accountId});
  }
  if(unavailable! > (closing>ZERO?closing:ZERO))add("unavailable_cash_invalid","Unavailable cash cannot exceed nonnegative closing included cash.");
  const toNumber=(value:bigint)=>{
    const n=Number(value)/scale;
    if(value>MAX_MINOR||value< -MAX_MINOR||!Number.isFinite(n)||minor(String(n),precision,true)!==value)add("invalid_money","Cash totals exceed the safe numeric range for the monthly contract.");
    return n;
  };
  const bridge=Object.fromEntries(CASH_BRIDGE_FIELDS.map(f=>[f,toNumber(totals[f])])) as Record<CashBridgeField,number>;
  const outflows=CASH_BRIDGE_FIELDS.filter(f=>!INFLOWS.has(f)).reduce((sum,f)=>sum+totals[f],ZERO);
  const month:NormalizedProviderMonth={month_date:batch.monthDate,opening_cash:toNumber(opening),closing_cash:toNumber(closing),
    total_revenue:bridge.cash_collected_from_customers,total_expenses:toNumber(outflows),payroll:null,ar_outstanding:null,ap_outstanding:null,notes:null,
    data_contract_version:2,source_type:"quickbooks",accounting_basis:"cash",reporting_currency:binding.reportingCurrency,period_status:"complete",period_cutoff_date:null,
    opening_included_cash:toNumber(opening),closing_included_cash:toNumber(closing),closing_unavailable_cash:toNumber(unavailable!),...bridge,
    closing_taxes_reserved:null,ar_expected_within_30_days:null,ap_due_within_30_days:null,available_credit:null,credit_currently_drawn:null,lowest_observed_cash:null};
  if(issues.length)return blocked();
  const cashAccountIds=[...selected].sort(),scope={businessId:binding.businessId,connectionId:binding.connectionId,companyId:binding.companyId,generation:binding.generation,reportingCurrency:binding.reportingCurrency};
  const cashPerimeterFingerprint=hash({policyVersion:PROVIDER_CASH_POLICY_VERSION,currency:binding.reportingCurrency,precision,cashAccountIds});
  const evidenceFingerprint=hash({policyVersion:PROVIDER_CASH_POLICY_VERSION,scope,cashPerimeterFingerprint,monthDate:batch.monthDate,
    balances:[...balances].sort(([a],[b])=>compare(a,b)).map(([accountId,b])=>({accountId,opening:b.opening.toString(),closing:b.closing.toString()})),
    unavailable:unavailable!.toString(),movements:evidence.sort((a,b)=>compare(a.id!,b.id!))});
  return {valid:true,month,provenance:{policyVersion:PROVIDER_CASH_POLICY_VERSION,scope,currencyPrecision:precision,monthDate:batch.monthDate,
    cashAccountIds,cashPerimeterFingerprint,evidenceFingerprint,retrievedAt:batch.retrievedAt,batchId:batch.batchId},issues,reconciliation,counts};
}
