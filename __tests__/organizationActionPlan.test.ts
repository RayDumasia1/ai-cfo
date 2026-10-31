import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
// Operator modules have no application imports, credentials or side effects.
import { actionOwnershipEvidenceSql,actionOwnershipPlan } from "../scripts/organization-action-plan.mjs";
let db:PGlite;
const evidence=async()=> (await db.query<{evidence:unknown}>(actionOwnershipEvidenceSql)).rows[0].evidence;
beforeAll(async()=>{
  db=new PGlite();await db.exec(`CREATE SCHEMA organization_private;
    CREATE TABLE business_profiles(id text,user_id text);
    CREATE TABLE legacy_account_organizations(current_business_profile_id text,legacy_user_id text,organization_id text,state text);
    CREATE TABLE organization_private.financial_scopes(organization_id text,legacy_business_profile_id text,legacy_user_id text);
    CREATE TABLE actions(id text,user_id text,business_id text,status text,linked_forecast_version_id text,linked_forecast_item_id text);
    CREATE TABLE action_audit_log(action_id text,user_id text);
    CREATE TABLE cash_forecasts(id text,user_id text,business_id text);
    CREATE TABLE cash_forecast_versions(id text,user_id text,forecast_id text);
    CREATE TABLE cash_forecast_items(id text,user_id text,version_id text);
    CREATE TABLE usage_tracking(user_id text,metric text,period_start timestamptz,period_end timestamptz,count integer,usage_limit integer);
    INSERT INTO business_profiles VALUES('p1','u1'),('p2','u2');
    INSERT INTO legacy_account_organizations VALUES('p1','u1','o1','live'),('p2','u2','o2','live');
    INSERT INTO organization_private.financial_scopes VALUES('o1','p1','u1'),('o2','p2','u2');`);
},20000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{await db.exec(`TRUNCATE actions,action_audit_log,cash_forecasts,cash_forecast_versions,cash_forecast_items,usage_tracking;
  DELETE FROM legacy_account_organizations WHERE state<>'live';
  INSERT INTO actions VALUES('a1','u1',NULL,'not_started',NULL,NULL);
  INSERT INTO action_audit_log VALUES('a1','u1');`);});
describe('D4 ownership preflight against populated SQL evidence',()=>{
  it('proposes only a null-link repair, leaves original data untouched and enables no authority',async()=>{
    const plan=actionOwnershipPlan(await evidence());expect(plan).toMatchObject({status:'READY_FOR_STORAGE_DESIGN',counts:{actions:1,audit:1,usage:0},proposed_null_business_repairs:1,authority_converted:false,storage_migration_applied:false});
    expect((await db.query<{business_id:null}>('SELECT business_id FROM actions')).rows[0].business_id).toBeNull();
  });
  it.each(["UPDATE actions SET business_id='p2'","UPDATE actions SET user_id='missing'","UPDATE action_audit_log SET user_id='u2'","UPDATE action_audit_log SET action_id='missing'"])("blocks conflicting owner/parent evidence: %s",async sql=>{
    await db.exec(sql);expect(actionOwnershipPlan(await evidence())).toMatchObject({status:'BLOCKED',proposed_null_business_repairs:0});
  });
  it('rejects same-user forecast links whose business differs',async()=>{
    await db.exec(`INSERT INTO cash_forecasts VALUES('f1','u1','p2');INSERT INTO cash_forecast_versions VALUES('v1','u1','f1');UPDATE actions SET linked_forecast_version_id='v1';`);
    expect(actionOwnershipPlan(await evidence()).blockers).toContainEqual({domain:'actions',reason:'foreign_forecast',rows:1});
  });
  it('rejects item links belonging to another version',async()=>{
    await db.exec(`INSERT INTO cash_forecasts VALUES('f1','u1','p1');INSERT INTO cash_forecast_versions VALUES('v1','u1','f1');INSERT INTO cash_forecast_items VALUES('i1','u1','v2');UPDATE actions SET linked_forecast_version_id='v1',linked_forecast_item_id='i1';`);
    expect(actionOwnershipPlan(await evidence()).blockers).toContainEqual({domain:'actions',reason:'foreign_item',rows:1});
  });
  it('preserves populated historical actions_created usage and rejects ambiguous or invalid counters',async()=>{
    await db.exec(`INSERT INTO usage_tracking VALUES('u1','actions_created','2026-10-15','2026-11-15',8,10);`);
    expect(actionOwnershipPlan(await evidence()).status).toBe('READY_FOR_STORAGE_DESIGN');
    await db.exec(`INSERT INTO usage_tracking SELECT * FROM usage_tracking;UPDATE usage_tracking SET count=-1;`);
    const plan=actionOwnershipPlan(await evidence());expect(plan.status).toBe('BLOCKED');expect(plan.blockers).toContainEqual({domain:'usage',reason:'duplicate_usage_keys',rows:1});
    expect(plan.blockers).toContainEqual({domain:'usage',reason:'invalid_count',rows:2});
  });
  it('refuses incomplete/malformed aggregate evidence',async()=>{
    expect(()=>actionOwnershipPlan({})).toThrow();const e=await evidence() as {actions:{null_business:number}};e.actions.null_business=2;expect(()=>actionOwnershipPlan(e)).toThrow();
  });
  it('does not assign detached historical actions or usage to a recreated current workspace',async()=>{
    await db.exec(`INSERT INTO legacy_account_organizations VALUES(NULL,'u1','old-org','detached');
      INSERT INTO usage_tracking VALUES('u1','actions_created','2026-10-15','2026-11-15',8,10);`);
    const plan=actionOwnershipPlan(await evidence());expect(plan.status).toBe('BLOCKED');
    expect(plan.blockers).toContainEqual({domain:'actions',reason:'ambiguous_history',rows:1});
    expect(plan.blockers).toContainEqual({domain:'usage',reason:'ambiguous_history',rows:1});
  });
  it('blocks unsupported metrics, invalid periods and negative stored limits',async()=>{
    await db.exec(`INSERT INTO usage_tracking VALUES('u1','actions_active','2026-11-15','2026-10-15',8,-1);`);
    const plan=actionOwnershipPlan(await evidence());
    for(const reason of ['unknown_metric','invalid_period','invalid_limit'])expect(plan.blockers).toContainEqual({domain:'usage',reason,rows:1});
  });
});
