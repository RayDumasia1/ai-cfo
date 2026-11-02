import { beforeEach,describe,it,expect,vi } from 'vitest';
vi.mock('../lib/supabase',()=>({supabase:{}}));
import {createAction,getActions,getAction,getActiveActionCount,deleteAction,consumeOwnedUsage,getOwnedUsageStatus,markWarningSent} from '../lib/db';
import {OperationalAuthorityError,operationalSelection,operationalErrorResponse} from '../lib/operationalAuthority';
const actor='10000000-0000-4000-8000-000000000001',org='20000000-0000-4000-8000-000000000001';
const rpc=vi.fn(),from=vi.fn(),client={rpc,from};
const row={id:'action',user_id:actor,organization_id:org,name:'Test',status:'not_started'};
const envelope=(data:object)=>({actorId:actor,organizationId:org,policyVersion:'org-operations-1',...data});
beforeEach(()=>{vi.resetAllMocks();rpc.mockResolvedValue({data:envelope({action:row}),error:null});});
describe('D4C operation adapters',()=>{
  it('uses actor-bound cookie RPCs without user IDs or profile overrides',async()=>{
    await createAction(actor,{name:'Test',goal_type:'risk_mitigation',business_id:null} as never,client as never,org);
    expect(rpc).toHaveBeenCalledWith('owned_action_operation',expect.objectContaining({p_operation:'create',p_organization_id:org,p_patch:{name:'Test',goal_type:'risk_mitigation'}}));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_user_id');expect(from).not.toHaveBeenCalled();
  });
  it('validates lists, missing single actions and current active counts',async()=>{
    rpc.mockResolvedValue({data:envelope({actions:[row]}),error:null});expect(await getActions(actor,{status:['in_progress']},client as never)).toEqual([row]);
    rpc.mockResolvedValue({data:envelope({action:null}),error:null});expect(await getAction(actor,'action',client as never)).toBeNull();
    rpc.mockResolvedValue({data:envelope({count:7}),error:null});expect(await getActiveActionCount(actor,client as never)).toBe(7);
    rpc.mockResolvedValue({data:envelope({actions:[{...row,organization_id:'other'}]}),error:null});await expect(getActions(actor,{},client as never)).rejects.toThrow('unavailable');
  });
  it('rejects mismatched acknowledgments and never falls back on missing schema',async()=>{
    rpc.mockResolvedValue({data:{...envelope({deleted:true}),actorId:'foreign'},error:null});await expect(deleteAction(actor,'action',client as never)).rejects.toThrow('unavailable');
    rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'private details'}});await expect(getActiveActionCount(actor,client as never)).rejects.toMatchObject({reason:'unavailable'});expect(from).not.toHaveBeenCalled();
  });
  it('accepts only SQL-derived policy/period and pins warning bookkeeping to consumed scope',async()=>{
    const period='2026-11-01T00:00:00.123456+00:00';
    rpc.mockResolvedValue({data:envelope({allowed:true,throttled:false,count:3,usage_limit:20,warning_sent_at:null,periodStart:period,entitlementTier:'core'}),error:null});
    expect(await consumeOwnedUsage(actor,'ask_cfo_questions',client as never,org)).toMatchObject({count:3,periodStart:period});
    expect(rpc.mock.calls[0][1]).toEqual({p_operation:'consume',p_metric:'ask_cfo_questions',p_organization_id:org,p_request_id:expect.any(String)});
    rpc.mockResolvedValue({data:envelope({marked:true}),error:null});await markWarningSent(actor,'ask_cfo_questions',period,client as never,org);
    expect(rpc).toHaveBeenLastCalledWith('owned_usage_operation',{p_operation:'mark_warning',p_metric:'ask_cfo_questions',p_period_start:period,p_organization_id:org});
  });
  it('validates usage status including active actions as a live count',async()=>{
    const usage=[{metric:'ask_cfo_questions',count:19,limit:20},{metric:'ai_insight_runs',count:1,limit:3},{metric:'actions_active',count:7,limit:50}];
    rpc.mockResolvedValue({data:envelope({entitlementTier:'core',usage}),error:null});expect(await getOwnedUsageStatus(actor,client as never)).toEqual(usage);
    rpc.mockResolvedValue({data:envelope({entitlementTier:'core',usage:[]}),error:null});await expect(getOwnedUsageStatus(actor,client as never)).rejects.toThrow('unavailable');
    rpc.mockResolvedValue({data:envelope({entitlementTier:'core',usage:[null]}),error:null});await expect(getOwnedUsageStatus(actor,client as never)).rejects.toThrow('unavailable');
  });
  it('rejects duplicate/malformed selectors and returns safe retry/access errors',()=>{
    expect(operationalSelection(new URLSearchParams({organization_id:org}))).toBe(org);
    expect(()=>operationalSelection(new URLSearchParams('organization_id=a&organization_id=b'))).toThrow('invalid_request');
    expect(operationalErrorResponse(new OperationalAuthorityError('busy'))).toMatchObject({status:409,code:'WORKSPACE_BUSY'});
    expect(operationalErrorResponse(new OperationalAuthorityError('not_found'))).toMatchObject({status:404});
  });
});
