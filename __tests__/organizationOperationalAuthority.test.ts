import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from 'vitest';
import { actionOwnershipSetup,actionMigration,seedAction } from './fixtures/actionOwnershipDb';
import { orgOwner,orgOther,orgProfile } from './fixtures/organizationDb';
const migration=()=>readFileSync(new URL('../docs/migrations/2026-11-01-organization-action-authority.sql',import.meta.url),'utf8');
let db:PGlite,own:string,foreign:string;
const value=async<T=unknown>(sql:string,args:unknown[]=[])=> (await db.query<{value:T}>(sql,args)).rows[0].value;
async function denied(sql:string,args:unknown[]=[],code='42501'){
  await db.exec('SAVEPOINT deny');try{await expect(db.query(sql,args)).rejects.toMatchObject({code});}finally{await db.exec('ROLLBACK TO SAVEPOINT deny; RELEASE SAVEPOINT deny');}
}
async function auth(user=orgOwner){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await db.exec('SET LOCAL ROLE authenticated');}
const op=(operation:string,id:string|null=null,patch:unknown={},organization:string|null=own)=>value<Record<string,unknown>>("SELECT public.owned_action_operation($1,$2,$3,$4::jsonb) AS value",[operation,organization,id,JSON.stringify(patch)]);
const quota=(operation='consume',metric='ask_cfo_questions',organization=own)=>value<Record<string,unknown>>('SELECT public.owned_usage_operation($1,$2,$3) AS value',[operation,metric,organization]);
describe('D4C authenticated organization action and budget authority',()=>{
  beforeAll(async()=>{
    db=new PGlite();await actionOwnershipSetup(db);await db.exec(actionMigration());
    await db.exec(`ALTER TABLE public.subscriptions ADD COLUMN billing_period_start timestamptz,ADD COLUMN billing_period_end timestamptz;
      UPDATE public.subscriptions SET billing_period_start=date_trunc('day',now())-interval '1 day',billing_period_end=date_trunc('day',now())+interval '29 days';`);
    await db.exec(migration());
    own=await value<string>('SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[orgOwner]);foreign=await value<string>('SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[orgOther]);
  },60000);
  afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('BEGIN');});afterEach(async()=>{await db.exec('ROLLBACK; RESET ROLE');});
  it('retains exact owner list/history/count and denies explicit foreign targets',async()=>{
    await auth();expect((await op('list')).actions).toHaveLength(2);expect((await op('count')).count).toBe(1);expect((await op('history',seedAction)).history).toHaveLength(1);
    await denied("SELECT public.owned_action_operation('list',$1)",[foreign],'P0002');
    expect(await value('SELECT count(*)::int AS value FROM public.actions WHERE user_id=$1',[orgOther])).toBe(0);
  });
  it('creates/updates/deletes with status history and surviving private attribution',async()=>{
    await auth();const created=await op('create',null,{name:'New action',goal_type:'risk_mitigation'});const id=(created.action as {id:string}).id;
    await op('update',id,{status:'completed'});expect((await op('history',id)).history).toHaveLength(1);await op('delete',id);
    expect((await op('get',id)).action).toBeNull();await db.exec('RESET ROLE');
    expect(await value('SELECT count(*)::int AS value FROM organization_private.operational_write_events WHERE resource_reference=$1',[id])).toBe(3);
    await denied('DELETE FROM organization_private.operational_write_events',[],'55000');
  });
  it('rejects raw authenticated and service mutations and legacy execution',async()=>{
    for(const role of ['authenticated','service_role']){
      await db.exec(`SET LOCAL ROLE ${role}`);
      await denied("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'Bypass','risk_mitigation')",[orgOwner]);
      await denied('DELETE FROM public.usage_tracking WHERE user_id=$1',[orgOwner]);
      await denied("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}')",[orgOwner,seedAction]);
      await denied("SELECT public.consume_usage($1,'ask_cfo_questions',now(),now()+interval '1 day',999,true)",[orgOwner]);
      expect(await value("SELECT has_table_privilege(current_user,'public.actions','TRUNCATE') AS value")).toBe(false);
      await db.exec('RESET ROLE');
    }
  });
  it('denies unverified owners and service/anonymous operation calls',async()=>{
    await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[orgOwner]);await auth();await denied("SELECT public.owned_action_operation('list')");
    await db.exec('RESET ROLE');for(const role of ['anon','service_role']){await db.exec(`SET LOCAL ROLE ${role}`);await denied("SELECT public.owned_action_operation('count')");await db.exec('RESET ROLE');}
  });
  it('preserves downgrade cleanup while checking current coverage for new slots',async()=>{
    await db.query("UPDATE public.subscriptions SET status='cancelled' WHERE user_id=$1",[orgOwner]);await auth();
    await op('update',seedAction,{status:'completed'});await op('create',null,{name:'Completed record',goal_type:'risk_mitigation',status:'completed'});
    await denied("SELECT public.owned_action_operation('create',NULL,NULL,'{\"name\":\"New\",\"goal_type\":\"risk_mitigation\"}')",[],'P0402');
    await op('delete',seedAction);
  });
  it('enforces organization action capacity and reopening atomically',async()=>{
    await db.query("UPDATE public.subscriptions SET feature_tier='starter' WHERE user_id=$1",[orgOwner]);await auth();
    for(let i=0;i<9;i++)await op('create',null,{name:`Slot ${i}`,goal_type:'risk_mitigation'});
    await denied("SELECT public.owned_action_operation('create',NULL,NULL,'{\"name\":\"Over\",\"goal_type\":\"risk_mitigation\"}')",[],'P0001');
    await op('update',seedAction,{status:'completed'});await op('update',seedAction,{status:'in_progress'});expect((await op('count')).count).toBe(10);
  });
  it('rejects actor, scope and profile payload overrides and bad field types',async()=>{
    await auth();for(const extra of [{user_id:orgOther},{organization_id:foreign},{business_id:orgProfile},{status:null},{goal_value:'bad'}]){
      await denied("SELECT public.owned_action_operation('create',NULL,NULL,$1::jsonb)",[JSON.stringify({name:'Bad',goal_type:'risk_mitigation',...extra})],'22023');
    }
  });
  it('derives finite quota policy and preserves current counters on hard denial',async()=>{
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit) SELECT user_id,'ask_cfo_questions',billing_period_start,billing_period_end,19,20 FROM public.subscriptions WHERE user_id=$1",[orgOwner]);
    await auth();expect(await quota()).toMatchObject({count:20,allowed:true,usage_limit:20});expect(await quota()).toMatchObject({count:20,allowed:false,throttled:false});
    expect((await quota('status')).usage).toEqual(expect.arrayContaining([{metric:'actions_active',count:1,limit:50}]));
    await db.exec('RESET ROLE');expect(await value("SELECT count AS value FROM public.usage_tracking WHERE user_id=$1 AND metric='actions_created'",[orgOwner])).toBe(8);
  });
  it('keeps unlimited tiers untracked and handles Growth overage/warning scope',async()=>{
    await auth(orgOther);const unlimited=await quota('consume','ai_insight_runs',foreign);expect(unlimited).toMatchObject({allowed:true,count:0,usage_limit:null});await db.exec('RESET ROLE');
    await db.query("UPDATE public.subscriptions SET feature_tier='growth' WHERE user_id=$1",[orgOwner]);
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit) SELECT user_id,'ask_cfo_questions',billing_period_start,billing_period_end,150,150 FROM public.subscriptions WHERE user_id=$1",[orgOwner]);
    await auth();const consumed=await quota();expect(consumed).toMatchObject({count:151,throttled:true,usage_limit:150});
    await value('SELECT public.owned_usage_operation(\'mark_warning\',\'ask_cfo_questions\',NULL,$1) AS value',[consumed.periodStart]);
    await denied("SELECT public.owned_usage_operation('mark_warning','ask_cfo_questions',NULL,now())",[],'P0002');
  });
  it('fails closed on missing/stale billing windows and wrong organizations',async()=>{
    await db.query('UPDATE public.subscriptions SET billing_period_start=NULL WHERE user_id=$1',[orgOwner]);await auth();
    await denied("SELECT public.owned_usage_operation('consume','ask_cfo_questions')",[],'55000');
    await denied("SELECT public.owned_usage_operation('status',NULL,$1)",[foreign],'P0002');
  });
  it('rolls back the action if private attribution fails late',async()=>{
    await db.exec("CREATE FUNCTION public.fail_operations_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_operations_event BEFORE INSERT ON organization_private.operational_write_events FOR EACH ROW EXECUTE FUNCTION public.fail_operations_event()");
    await auth();await denied("SELECT public.owned_action_operation('update',NULL,$1,'{\"status\":\"completed\"}')",[seedAction],'P0001');expect(((await op('get',seedAction)).action as {status:string}).status).toBe('in_progress');
  });
  it('keeps actual forecast handoff and linked-draft discard protection',async()=>{
    await db.exec('SET LOCAL ROLE service_role');const draft=await value<{version_id:string;updated_at:string}>("SELECT public.begin_cash_forecast_draft($1,$2,'USD','2098-01-01','2098-01-01',1000,0,0,NULL,'d4c-fixture','{}') AS value",[orgOwner,orgProfile]);
    await db.exec('RESET ROLE');await auth();await op('create',null,{name:'Linked draft',goal_type:'risk_mitigation',linked_forecast_version_id:draft.version_id});
    await db.exec('SET LOCAL ROLE service_role');expect(await value('SELECT public.discard_cash_forecast_draft($1,$2,$3) AS value',[orgOwner,draft.version_id,draft.updated_at])).toMatchObject({reason:'linked_action',discarded:false});
  });
  it('rolls back quota admission on a late attribution failure',async()=>{
    await db.exec("CREATE FUNCTION public.fail_quota_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_quota_event BEFORE INSERT ON organization_private.operational_write_events FOR EACH ROW EXECUTE FUNCTION public.fail_quota_event()");
    await auth();await denied("SELECT public.owned_usage_operation('consume','ask_cfo_questions')",[],'P0001');await db.exec('RESET ROLE');
    expect(await value('SELECT count(*)::int AS value FROM public.usage_tracking u JOIN public.subscriptions s ON s.user_id=u.user_id AND s.billing_period_start=u.period_start WHERE u.user_id=$1',[orgOwner])).toBe(0);
  });
  it('does not rebucket historical counters into a recreated workspace',async()=>{
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit) SELECT user_id,'ask_cfo_questions',billing_period_start,billing_period_end,19,20 FROM public.subscriptions WHERE user_id=$1",[orgOwner]);
    await db.query('DELETE FROM public.business_profiles WHERE id=$1',[orgProfile]);await auth();await value('SELECT public.ensure_owned_business_profile() AS value');
    await denied("SELECT public.owned_usage_operation('status')",[],'55000');await denied("SELECT public.owned_usage_operation('consume','ask_cfo_questions')",[],'55000');
  });
});
