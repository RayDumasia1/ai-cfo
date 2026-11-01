import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from 'vitest';
import { actionOwnershipSetup,actionMigration,seedAction } from './fixtures/actionOwnershipDb';
import { orgOwner,orgOther,orgProfile,orgOtherProfile } from './fixtures/organizationDb';
let db:PGlite,own:string,foreign:string;
const value=async<T=unknown>(sql:string,args:unknown[]=[])=> (await db.query<{value:T}>(sql,args)).rows[0].value;
async function denied(sql:string,args:unknown[]=[],code='23514'){
  await db.exec('SAVEPOINT deny');try{await expect(db.query(sql,args)).rejects.toMatchObject({code});}finally{await db.exec('ROLLBACK TO SAVEPOINT deny; RELEASE SAVEPOINT deny');}
}
async function auth(){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[orgOwner]);await db.exec('SET LOCAL ROLE authenticated');}
describe('ORG-01D4B action/history/usage ownership storage',()=>{
  beforeAll(async()=>{
    db=new PGlite();await actionOwnershipSetup(db);
    const before:Record<string,unknown[]>={};for(const table of ['actions','action_audit_log','usage_tracking'])before[table]=(await db.query<{row:Record<string,unknown>}>(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(r=>r.row);
    await db.exec(actionMigration());
    for(const table of ['actions','action_audit_log','usage_tracking']){
      const after=(await db.query<{row:unknown}>(`SELECT to_jsonb(t)-'organization_id' AS row FROM public.${table} t ORDER BY id`)).rows.map(r=>r.row);
      const expected=table==='actions'?before[table].map(r=>{const a=r as Record<string,unknown>;return {...a,business_id:a.business_id??orgProfile};}):before[table];
      expect(after).toEqual(expected);
    }
    own=await value<string>('SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[orgOwner]);
    foreign=await value<string>('SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[orgOther]);
  },60000);
  afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('BEGIN');});afterEach(async()=>{await db.exec('ROLLBACK; RESET ROLE');});
  it('records only actual null-link repairs and preserves exact old fields',async()=>{
    expect(await value('SELECT count(*)::int AS value FROM organization_private.action_scope_repairs')).toBe(2);
    expect(await value('SELECT business_id AS value FROM public.actions WHERE id=$1',[seedAction])).toBe(orgProfile);
    expect(await value('SELECT count(*)::int AS value FROM public.usage_tracking WHERE organization_id=$1',[own])).toBe(2);
    await denied('UPDATE organization_private.action_scope_repairs SET database_operator=\'changed\'',[],'55000');
  });
  it('stamps legacy authenticated creation and atomic status history without broadening RLS',async()=>{
    await auth();const a=await value<{id:string;business_id:string;organization_id:string}>("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'New action','risk_mitigation') RETURNING to_jsonb(actions) AS value",[orgOwner]);
    expect(a).toMatchObject({business_id:orgProfile,organization_id:own});
    const changed=await value<{status:string}>("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}','Done') AS value",[orgOwner,a.id]);expect(changed.status).toBe('completed');
    expect(await value('SELECT organization_id AS value FROM public.action_audit_log WHERE action_id=$1',[a.id])).toBe(own);
    expect(await value('SELECT count(*)::int AS value FROM public.actions WHERE user_id=$1',[orgOther])).toBe(0);
    await denied("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'Foreign','risk_mitigation')",[orgOther],'42501');
  });
  it('rejects foreign scope/profile and immutable owner/key changes through service DML',async()=>{
    await db.exec('SET LOCAL ROLE service_role');
    await denied("INSERT INTO public.actions(user_id,organization_id,name,goal_type) VALUES($1,$2,'Wrong','risk_mitigation')",[orgOwner,foreign]);
    await denied("INSERT INTO public.actions(user_id,business_id,name,goal_type) VALUES($1,$2,'Wrong','risk_mitigation')",[orgOwner,orgOtherProfile]);
    for(const [column,v] of [['organization_id',foreign],['user_id',orgOther],['business_id',orgOtherProfile],['business_id',null]])await denied(`UPDATE public.actions SET ${column}=$1 WHERE id=$2`,[v,seedAction]);
    await denied("UPDATE public.usage_tracking SET metric='ai_insight_runs' WHERE user_id=$1 AND metric='actions_created'",[orgOwner]);
    await denied("UPDATE public.usage_tracking SET period_start='2026-10-16' WHERE user_id=$1",[orgOwner]);
  });
  it('rejects forged history parents and cross-organization usage',async()=>{
    await db.exec('SET LOCAL ROLE service_role');
    await denied("INSERT INTO public.action_audit_log(action_id,user_id,new_status) VALUES($1,$2,'completed')",[seedAction,orgOther]);
    await denied("INSERT INTO public.action_audit_log(action_id,user_id,organization_id,new_status) VALUES($1,$2,$3,'completed')",[seedAction,orgOwner,foreign]);
    await denied("INSERT INTO public.usage_tracking(user_id,organization_id,metric,period_start,period_end) VALUES($1,$2,'ai_insight_runs','2098-01-01','2098-02-01')",[orgOwner,foreign]);
    await denied('UPDATE public.usage_tracking SET count=-1 WHERE user_id=$1',[orgOwner]);
  });
  it('enforces composite history integrity independently of the stamping trigger',async()=>{
    await db.exec('ALTER TABLE public.action_audit_log DISABLE TRIGGER organization_action_budget_ownership');
    await denied("INSERT INTO public.action_audit_log(action_id,user_id,organization_id,new_status) VALUES($1,$2,$3,'completed')",[seedAction,orgOther,foreign],'23503');
  });
  it('preserves finite denial/overage decisions, legacy counters and warning timestamps',async()=>{
    await db.exec('SET LOCAL ROLE service_role');
    const call="SELECT public.consume_usage($1,'ask_cfo_questions','2026-10-15','2026-11-15',20,$2) AS value";
    expect(await value(call,[orgOwner,false])).toMatchObject({allowed:true,count:20,throttled:false});
    expect(await value(call,[orgOwner,false])).toMatchObject({allowed:false,count:20,throttled:false});
    expect(await value(call,[orgOwner,true])).toMatchObject({allowed:true,count:21,throttled:true});
    expect(await value("SELECT count AS value FROM public.usage_tracking WHERE user_id=$1 AND metric='actions_created'",[orgOwner])).toBe(8);
    expect(await value("SELECT warning_sent_at::text AS value FROM public.usage_tracking WHERE user_id=$1 AND metric='ask_cfo_questions'",[orgOwner])).toContain('.123456');
  });
  it('allows profile deletion detachment and retains stable organization/repair evidence',async()=>{
    await db.query('DELETE FROM public.business_profiles WHERE id=$1',[orgProfile]);
    expect(await value('SELECT business_id AS value FROM public.actions WHERE id=$1',[seedAction])).toBeNull();
    expect(await value('SELECT organization_id AS value FROM public.actions WHERE id=$1',[seedAction])).toBe(own);
    expect(await value('SELECT count(*)::int AS value FROM organization_private.action_scope_repairs')).toBe(2);
  });
  it('preserves the existing NO ACTION usage/Auth FK and cascades after explicit fixture usage removal',async()=>{
    await denied('DELETE FROM auth.users WHERE id=$1',[orgOwner],'23503');
    expect(await value('SELECT count(*)::int AS value FROM public.actions WHERE user_id=$1',[orgOwner])).toBe(2);
    await db.query('DELETE FROM public.usage_tracking WHERE user_id=$1',[orgOwner]);await db.query('DELETE FROM auth.users WHERE id=$1',[orgOwner]);
    expect(await value('SELECT count(*)::int AS value FROM public.actions WHERE user_id=$1',[orgOwner])).toBe(0);
    expect(await value('SELECT count(*)::int AS value FROM organization_private.action_scope_repairs')).toBe(2);
  });
  it('retains forecast handoff and draft discard protection',async()=>{
    await db.exec('SET LOCAL ROLE service_role');
    const draft=await value<{version_id:string;updated_at:string}>("SELECT public.begin_cash_forecast_draft($1,$2,'USD','2098-01-01','2098-01-01',1000,0,0,NULL,'fixture','{}') AS value",[orgOwner,orgProfile]);
    await db.query('UPDATE public.actions SET linked_forecast_version_id=$1 WHERE id=$2',[draft.version_id,seedAction]);
    expect(await value('SELECT public.discard_cash_forecast_draft($1,$2,$3) AS value',[orgOwner,draft.version_id,draft.updated_at])).toMatchObject({discarded:false,reason:'linked_action'});
    await denied('UPDATE public.actions SET linked_forecast_version_id=$1 WHERE user_id=$2',[draft.version_id,orgOther]);
  });
  it('keeps repair storage/helper grants private and rejects migration replay',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      expect(await value("SELECT has_table_privilege($1,'organization_private.action_scope_repairs','SELECT,INSERT,UPDATE,DELETE') AS value",[role])).toBe(false);
      expect(await value("SELECT has_function_privilege($1,'organization_private.guard_action_budget_ownership()','EXECUTE') AS value",[role])).toBe(false);
    }
    await expect(db.exec(actionMigration())).rejects.toThrow(/already installed/);
  });
  it('keeps active-slot limits, completion and reopening behavior intact',async()=>{
    await auth();await db.query("INSERT INTO public.actions(user_id,name,goal_type) SELECT $1,'Capacity fixture','risk_mitigation' FROM generate_series(1,49)",[orgOwner]);
    await denied("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'Over limit','risk_mitigation')",[orgOwner],'P0001');
    const completed=await value<string>("SELECT id AS value FROM public.actions WHERE user_id=$1 AND status='completed' LIMIT 1",[orgOwner]);
    await denied("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"in_progress\"}')",[orgOwner,completed],'P0001');
    await db.query("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}')",[orgOwner,seedAction]);
    await db.query("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"in_progress\"}')",[orgOwner,completed]);
    expect(await value("SELECT count(*)::int AS value FROM public.actions WHERE user_id=$1 AND status<>'completed'",[orgOwner])).toBe(50);
  });
  it('rolls action/status history back together on late audit failure',async()=>{
    await db.exec("CREATE FUNCTION public.fail_d4b_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_d4b_audit BEFORE INSERT ON public.action_audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_d4b_audit()");
    const before=await value('SELECT to_jsonb(a) AS value FROM public.actions a WHERE id=$1',[seedAction]);await auth();
    await denied("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}')",[orgOwner,seedAction],'P0001');
    expect(await value('SELECT to_jsonb(a) AS value FROM public.actions a WHERE id=$1',[seedAction])).toEqual(before);
  });
});

describe('D4B preflight and failed-install rollback',()=>{
  let base:PGlite;
  beforeAll(async()=>{base=new PGlite();await actionOwnershipSetup(base);},60000);
  afterAll(async()=>{await base?.close();});
  beforeEach(async()=>{await base.exec('BEGIN');});afterEach(async()=>{await base.exec('ROLLBACK');});
  it.each([
    ['foreign action business',`UPDATE public.actions SET business_id='${orgOtherProfile}' WHERE id='${seedAction}'`],
    ['foreign history parent',`UPDATE public.action_audit_log SET user_id='${orgOther}'`],
    ['invalid populated usage',"UPDATE public.usage_tracking SET count=-1"],
    ['partial organization column','ALTER TABLE public.actions ADD COLUMN organization_id uuid'],
    ['unexpected trigger',"CREATE TRIGGER extra_action_trigger BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()"],
    ['late DDL collision','CREATE INDEX actions_organization_identity ON public.actions(id)'],
    ['unexpected deletion policy','ALTER TABLE public.usage_tracking DROP CONSTRAINT usage_tracking_user_id_fkey; ALTER TABLE public.usage_tracking ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE'],
    ['detached/recreated owner history',`DELETE FROM public.business_profiles WHERE id='${orgProfile}'; INSERT INTO public.business_profiles(user_id) VALUES('${orgOwner}')`],
  ])('aborts %s and restores rows, trigger state and schema',async(_label,setup)=>{
    const before=(await base.query('SELECT to_jsonb(a) AS row FROM public.actions a ORDER BY id')).rows;
    await base.exec(setup);
    await expect(base.exec(actionMigration().replace(/\nBEGIN;\r?\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n'))).rejects.toThrow();
    await base.exec('ROLLBACK');
    expect((await base.query('SELECT to_jsonb(a) AS row FROM public.actions a ORDER BY id')).rows).toEqual(before);
    expect((await base.query<{ledger:null}>("SELECT to_regclass('organization_private.action_scope_repairs') AS ledger")).rows[0].ledger).toBeNull();
    expect((await base.query<{n:number}>("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='actions' AND column_name='organization_id'")).rows[0].n).toBe(0);
    expect((await base.query<{n:number}>("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='public.actions'::regclass AND NOT tgisinternal AND tgenabled='O'")).rows[0].n).toBe(3);
  });
});
