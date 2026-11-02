import { beforeEach,describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('../utils/supabase/server',()=>({createClient:vi.fn()}));
vi.mock('../lib/db',()=>({createAction:vi.fn(),deleteAction:vi.fn(),getAction:vi.fn(),updateAction:vi.fn(),getOwnedUsageStatus:vi.fn()}));
import {createClient} from '../utils/supabase/server';
import {createAction,deleteAction,getAction,updateAction,getOwnedUsageStatus} from '../lib/db';
import {POST} from '../app/api/actions/route';
import {PATCH,DELETE} from '../app/api/actions/[id]/route';
import {GET} from '../app/api/usage/route';
import {OperationalAuthorityError} from '../lib/operationalAuthority';
const org='20000000-0000-4000-8000-000000000001',client={auth:{getUser:vi.fn()}},ctx={params:Promise.resolve({id:'action'})};
const req=(method:string,path='/api/actions',body:unknown={name:'Test',goal_type:'risk_mitigation'})=>new NextRequest(`https://example.invalid${path}`,{method,...(method==='GET'||method==='DELETE'?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(createClient).mockResolvedValue(client as never);client.auth.getUser.mockResolvedValue({data:{user:{id:'actor',email:'test@example.invalid',email_confirmed_at:'2026-01-01'}},error:null});vi.mocked(getAction).mockResolvedValue({id:'action'} as never);vi.mocked(createAction).mockResolvedValue({id:'new'} as never);vi.mocked(updateAction).mockResolvedValue({id:'action'} as never);});
describe('D4C scoped HTTP routes',()=>{
  it('pins explicit organization selection for create, edit and delete',async()=>{
    expect((await POST(req('POST',`/api/actions?organization_id=${org}`),{})).status).toBe(201);
    expect(createAction).toHaveBeenCalledWith('actor',expect.any(Object),client,org);
    expect((await PATCH(req('PATCH',`/api/actions/action?organization_id=${org}`,{status:'completed'}),ctx)).status).toBe(200);
    expect(updateAction).toHaveBeenCalledWith('actor','action',{status:'completed'},{organizationId:org},client);
    expect((await DELETE(req('DELETE',`/api/actions/action?organization_id=${org}`),ctx)).status).toBe(204);
    expect(deleteAction).toHaveBeenCalledWith('actor','action',client,org);
  });
  it('denies duplicate or foreign scope without default fallback',async()=>{
    expect((await POST(req('POST',`/api/actions?organization_id=${org}&organization_id=${org}`),{})).status).toBe(400);expect(createAction).not.toHaveBeenCalled();
    vi.mocked(createAction).mockRejectedValue(new OperationalAuthorityError('not_found'));
    expect((await POST(req('POST',`/api/actions?organization_id=${org}`),{})).status).toBe(404);expect(createAction).toHaveBeenCalledTimes(1);
  });
  it('returns non-cacheable usage, and unavailable instead of an empty fabricated usage list',async()=>{
    vi.mocked(getOwnedUsageStatus).mockResolvedValue([{metric:'actions_active',count:7,limit:50}]);
    const response=await GET(req('GET',`/api/usage?organization_id=${org}`),{});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(getOwnedUsageStatus).toHaveBeenCalledWith('actor',client,org);
    vi.mocked(getOwnedUsageStatus).mockRejectedValue(new OperationalAuthorityError('unavailable'));expect((await GET(req('GET','/api/usage'),{})).status).toBe(503);
  });
  it('blocks unverified sessions and maps contention to an explicit retry',async()=>{
    client.auth.getUser.mockResolvedValue({data:{user:{id:'actor',email_confirmed_at:null}},error:null});expect((await GET(req('GET','/api/usage'),{})).status).toBe(403);expect(getOwnedUsageStatus).not.toHaveBeenCalled();
    client.auth.getUser.mockResolvedValue({data:{user:{id:'actor',email_confirmed_at:'2026-01-01'}},error:null});vi.mocked(createAction).mockRejectedValue(new OperationalAuthorityError('busy'));
    const r=await POST(req('POST'),{});expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'WORKSPACE_BUSY'});
  });
});
