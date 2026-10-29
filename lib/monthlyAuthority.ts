import { organizationSelection } from "./organizationAccess";
import type { OwnerReadContext } from "./organizationAccess";
export type MonthlyAuthorityReason="unauthorized"|"not_found"|"subscription_required"|"changed"|"busy"|"invalid_request"|"unavailable";
export class MonthlyAuthorityError extends Error {
  constructor(public readonly reason:MonthlyAuthorityReason){super(reason);this.name="MonthlyAuthorityError";}
}
export function monthlyFailure(error:{code?:string;message?:string}):never{
  const reason:MonthlyAuthorityReason=error.code==="42501"?"unauthorized":error.code==="P0002"?"not_found":error.code==="P0402"?"subscription_required":
    error.code==="P0001"&&error.message==="import_review_stale"?"changed":["55P03","40P01","40001"].includes(error.code??"")?"busy":
    ["22023","22P02"].includes(error.code??"")?"invalid_request":"unavailable";
  throw new MonthlyAuthorityError(reason);
}
export function monthlyErrorResponse(error:unknown):{status:number;error:string;code?:string}|null{
  if(!(error instanceof MonthlyAuthorityError))return null;
  switch(error.reason){
    case "subscription_required":return{status:402,error:"An active subscription is required"};
    case "unauthorized":return{status:403,error:"Workspace access could not be confirmed."};
    case "not_found":return{status:404,error:"Workspace unavailable."};
    case "invalid_request":return{status:400,error:"Invalid workspace request."};
    case "changed":return{status:409,error:"Your financial data changed since this review. Select the file and review it again.",code:"IMPORT_REVIEW_STALE"};
    case "busy":return{status:409,error:"Your workspace is busy. Try again in a moment.",code:"WORKSPACE_BUSY"};
    default:return{status:503,error:"Workspace access is temporarily unavailable. Try again."};
  }
}
export function monthlySelection(params:URLSearchParams):string|null{
  const values=params.getAll("organization_id");
  try{return organizationSelection(values.length===0?undefined:values.length===1?values[0]:values);}
  catch{throw new MonthlyAuthorityError("invalid_request");}
}
export type OwnerWriteContext=Omit<OwnerReadContext,"policyVersion"|"capability"> & {policyVersion:"org-owner-write-1";capability:"financial.months.write"};
const uuid=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function assertMonthlyAcknowledgment(data:unknown,actorId:string,selected:string|null):void{
  const r=data as {actorId?:unknown;organizationId?:unknown}|null;
  if(!r||r.actorId!==actorId||!uuid(r.organizationId)||(selected!==null&&r.organizationId!==selected))throw new MonthlyAuthorityError("unavailable");
}
export function validateOwnerWriteContext(raw:unknown,actorId:string,selected:string|null):OwnerWriteContext{
  const c=raw as Partial<OwnerWriteContext>|null;
  if(!c||typeof c!=="object"||c.actorId!==actorId||!uuid(c.organizationId)||!uuid(c.businessProfileId)||!uuid(c.membershipId)||
    (selected!==null&&c.organizationId!==selected)||!Number.isSafeInteger(c.accessRevision)||Number(c.accessRevision)<1||
    !Number.isSafeInteger(c.membershipRevision)||Number(c.membershipRevision)<1||c.policyVersion!=="org-owner-write-1"||c.capability!=="financial.months.write"||
    c.entitlementSource!=="legacy_subscription"||!["starter","core","growth","advisory"].includes(String(c.entitlementTier))||
    (c.dataVersion!==null&&typeof c.dataVersion!=="string")||(c.businessName!==null&&typeof c.businessName!=="string"))throw new MonthlyAuthorityError("unavailable");
  return c as OwnerWriteContext;
}
