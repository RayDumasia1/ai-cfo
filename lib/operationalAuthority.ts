import { organizationSelection } from './organizationAccess';
import { getActionCapacityError } from './actions';
export type OperationalReason='unauthorized'|'not_found'|'subscription_required'|'busy'|'invalid_request'|'unavailable';
export class OperationalAuthorityError extends Error {
  constructor(public readonly reason:OperationalReason){super(reason);this.name='OperationalAuthorityError';}
}
export function operationalFailure(error:{code?:string;message?:string}):never{
  if(getActionCapacityError(error))throw error;
  throw new OperationalAuthorityError(error.code==='42501'?'unauthorized':error.code==='P0002'?'not_found':error.code==='P0402'?'subscription_required':
    ['55P03','40P01','40001'].includes(error.code??'')?'busy':['22023','22P02','22007','22008','22003'].includes(error.code??'')?'invalid_request':'unavailable');
}
export function operationalErrorResponse(error:unknown){
  if(!(error instanceof OperationalAuthorityError))return null;
  switch(error.reason){
    case 'unauthorized':return {status:403,error:'Workspace access could not be confirmed.'};
    case 'not_found':return {status:404,error:'Action or workspace unavailable.'};
    case 'subscription_required':return {status:402,error:'An active subscription is required'};
    case 'invalid_request':return {status:400,error:'Invalid workspace request.'};
    case 'busy':return {status:409,error:'Your workspace is busy. Try again in a moment.',code:'WORKSPACE_BUSY'};
    default:return {status:503,error:'Workspace access is temporarily unavailable. Try again.'};
  }
}
export function operationalSelection(params:URLSearchParams):string|null{
  const values=params.getAll('organization_id');
  try{return organizationSelection(values.length===0?undefined:values.length===1?values[0]:values);}catch{throw new OperationalAuthorityError('invalid_request');}
}
export function validateOperationalEnvelope(raw:unknown,actor:string,selected:string|null):Record<string,unknown>{
  const r=raw as Record<string,unknown>|null;
  if(!r||typeof r!=='object'||Array.isArray(r)||r.actorId!==actor||typeof r.organizationId!=='string'||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.organizationId)||(selected!==null&&r.organizationId!==selected)||r.policyVersion!=='org-operations-1')throw new OperationalAuthorityError('unavailable');
  return r;
}
export function validateOperationalRow(raw:unknown,actor:string,organization:unknown,id?:string):void{
  const r=raw as Record<string,unknown>|null;
  if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||r.user_id!==actor||r.organization_id!==organization||(id!==undefined&&r.id!==id))throw new OperationalAuthorityError('unavailable');
}
