// D4B preview only. All fixtures roll back. --rehearse also rolls back DDL;
// --apply installs the reviewed expansion once, including audited real repairs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { previewConnection } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
const args=process.argv.slice(2);
if(args.length>1||args.some(a=>!['--apply','--rehearse'].includes(a)))throw new Error('Use --apply, --rehearse or no arguments');
const users=[process.env.PREVIEW_TEST_ACCOUNT_A,process.env.PREVIEW_TEST_ACCOUNT_B];
if(users.some(v=>!v)||users[0]===users[1])throw new Error('Two dedicated preview accounts required');
const config={connectionString:previewConnection(process.env),connectionTimeoutMillis:15000,application_name:'org-01d4b-storage-preview'};
const db=new Client(config);const targets=['actions','action_audit_log','usage_tracking'];let stage='connect';
const migration=readFileSync(new URL('../docs/migrations/2026-10-31-organization-action-ownership.sql',import.meta.url),'utf8');
async function fingerprint(repairNullBusiness=false){
  const report={};for(const {tablename} of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){
    if(!/^[a-z][a-z0-9_]*$/.test(tablename))throw new Error('Unexpected identifier');
    let expr=targets.includes(tablename)?"to_jsonb(t)-'organization_id'":'to_jsonb(t)';
    if(tablename==='actions'&&repairNullBusiness)expr=`CASE WHEN t.business_id IS NULL AND p.id IS NOT NULL THEN jsonb_set(${expr},'{business_id}',to_jsonb(p.id)) ELSE ${expr} END`;
    report[tablename]=(await db.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5((${expr})::text),'' ORDER BY md5((${expr})::text)),'')) AS digest
      FROM public.${tablename} t ${tablename==='actions'?'LEFT JOIN public.business_profiles p ON p.user_id=t.user_id':''}`)).rows[0];
  }return report;
}
async function accessCatalog(){return(await db.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies,
  (SELECT jsonb_object_agg(role,privileges) FROM (SELECT r.role,jsonb_object_agg(v.privilege,has_table_privilege(r.role,c.oid,v.privilege)) AS privileges
  FROM (VALUES('anon'),('authenticated'),('service_role')) r(role) CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege) GROUP BY r.role) checks) AS grants
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,[targets])).rows;}
async function asOwner(user=users[0]){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await db.query('SET LOCAL ROLE authenticated');}
async function denied(sql,values=[],code='23514'){
  await db.query('SAVEPOINT deny');try{await assert.rejects(db.query(sql,values),e=>e.code===code);}finally{await db.query('ROLLBACK TO SAVEPOINT deny; RELEASE SAVEPOINT deny');}
}
async function fixture(run){await db.query('SAVEPOINT fixture');try{await run();}finally{await db.query('ROLLBACK TO SAVEPOINT fixture; RELEASE SAVEPOINT fixture');await db.query('RESET ROLE');}}
async function freshProfile(){
  const id=randomUUID();await db.query('RESET ROLE');await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[id]);
  await asOwner(id);const profile=(await db.query('SELECT public.ensure_owned_business_profile() AS p')).rows[0].p;await db.query('RESET ROLE');return {id,profile};
}
try{
  await db.connect();
  const installed=(await db.query("SELECT to_regclass('organization_private.action_scope_repairs') IS NOT NULL AS installed")).rows[0].installed;
  const ownerRows=(await db.query('SELECT legacy_user_id AS user_id,legacy_business_profile_id AS profile_id,organization_id FROM organization_private.financial_scopes WHERE legacy_user_id=ANY($1::uuid[])',[users])).rows;
  const own=ownerRows.find(r=>r.user_id===users[0]),foreign=ownerRows.find(r=>r.user_id===users[1]);assert.ok(own&&foreign);
  const before=await fingerprint(!installed),access=await accessCatalog();
  const repairs=installed?[]:(await db.query(`SELECT a.id,a.user_id,p.id AS profile_id,l.organization_id,md5(to_jsonb(a)::text) AS digest FROM public.actions a
    LEFT JOIN public.business_profiles p ON p.user_id=a.user_id LEFT JOIN public.legacy_account_organizations l ON l.current_business_profile_id=p.id AND l.legacy_user_id=a.user_id AND l.state='live'
    WHERE a.business_id IS NULL`)).rows;
  if(args.includes('--rehearse')){
    assert.equal(installed,false,'Rehearsal requires the D4A baseline');stage='populated rehearsal';await db.query('BEGIN');
    // Prove backfill of populated counters, not just the currently empty table.
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit,warning_sent_at) VALUES($1,'ask_cfo_questions','2098-01-01','2098-02-01',19,20,'2098-01-10 00:00:00.123456+00'),($1,'actions_created','2098-01-01','2098-02-01',8,NULL,NULL),($2,'ai_insight_runs','2098-01-01','2098-02-01',0,3,NULL)",users);
    const populated=await fingerprint(true);await db.query(migration.replace(/\nBEGIN;\r?\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n'));
    assert.deepEqual(await fingerprint(),populated);console.log('PASS: rehearsed populated counter/period/warning preservation and exact legacy action/history fields.');
  }else{
    if(!installed){assert.ok(args.includes('--apply'),'Reviewed D4B install required');stage='migration';await db.query(migration);console.log(`Installed D4B in preview; ${repairs.length} checked null-business repairs recorded.`);}
    assert.deepEqual(await fingerprint(),before);await db.query('BEGIN');
  }
  stage='catalog and correction evidence';assert.deepEqual(await accessCatalog(),access);
  for(const table of targets){
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table} t LEFT JOIN organization_private.financial_scopes s ON s.organization_id=t.organization_id AND s.legacy_user_id=t.user_id WHERE s.organization_id IS NULL`)).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2 AND convalidated",[`public.${table}`,`${table}_organization_owner_fk`])).rows[0].n,1);
  }
  for(const repair of repairs){
    const recorded=(await db.query('SELECT source_row_fingerprint,organization_id,legacy_owner_reference,repaired_business_reference,previous_business_reference FROM organization_private.action_scope_repairs WHERE action_reference=$1',[repair.id])).rows[0];
    assert.deepEqual(recorded,{source_row_fingerprint:repair.digest,organization_id:repair.organization_id,legacy_owner_reference:repair.user_id,repaired_business_reference:repair.profile_id,previous_business_reference:null});
  }
  if(!installed)assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.action_scope_repairs')).rows[0].n,repairs.length);
  for(const role of ['anon','authenticated','service_role']){
    assert.equal((await db.query("SELECT has_table_privilege($1,'organization_private.action_scope_repairs','SELECT,INSERT,UPDATE,DELETE') AS allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_function_privilege($1,'organization_private.guard_action_budget_ownership()','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
  }
  await denied("UPDATE organization_private.action_scope_repairs SET database_operator='changed'",[],'55000');
  const stable=await fingerprint();console.log('PASS: original fields preserved except proven null-business repair; RLS/grants unchanged, composite scope and private immutable correction evidence valid.');
  stage='legacy action and history';await fixture(async()=>{
    await asOwner();const a=(await db.query("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'D4B rollback fixture','risk_mitigation') RETURNING *",[own.user_id])).rows[0];
    assert.equal(a.organization_id,own.organization_id);assert.equal(a.business_id,own.profile_id);
    await db.query("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}','fixture')",[own.user_id,a.id]);
    assert.equal((await db.query('SELECT organization_id FROM public.action_audit_log WHERE action_id=$1',[a.id])).rows[0].organization_id,own.organization_id);
    await denied('UPDATE public.actions SET business_id=NULL WHERE id=$1',[a.id]);await denied('UPDATE public.actions SET organization_id=$1 WHERE id=$2',[foreign.organization_id,a.id]);
    await db.query('RESET ROLE');await db.query('SET LOCAL ROLE service_role');
    await denied("INSERT INTO public.action_audit_log(action_id,user_id,new_status) VALUES($1,$2,'completed')",[a.id,foreign.user_id]);
    await denied("INSERT INTO public.usage_tracking(user_id,organization_id,metric,period_start,period_end) VALUES($1,$2,'ai_insight_runs','2098-03-01','2098-04-01')",[own.user_id,foreign.organization_id]);
    await db.query('DELETE FROM public.actions WHERE id=$1',[a.id]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.action_audit_log WHERE action_id=$1',[a.id])).rows[0].n,0);
  });
  stage='populated usage and late audit';await fixture(async()=>{
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit,warning_sent_at) VALUES($1,'ask_cfo_questions','2098-03-01','2098-04-01',19,20,'2098-03-10 00:00:00.123456+00')",[own.user_id]);
    await db.query('SET LOCAL ROLE service_role');
    for(const [overage,count,allowed,throttled] of [[false,20,true,false],[false,20,false,false],[true,21,true,true]]){
      const result=(await db.query("SELECT public.consume_usage($1,'ask_cfo_questions','2098-03-01','2098-04-01',20,$2) AS value",[own.user_id,overage])).rows[0].value;
      assert.equal(result.count,count);assert.equal(result.allowed,allowed);assert.equal(result.throttled,throttled);
    }
    assert.ok((await db.query("SELECT warning_sent_at::text AS value FROM public.usage_tracking WHERE user_id=$1 AND metric='ask_cfo_questions' AND period_start='2098-03-01'",[own.user_id])).rows[0].value.includes('.123456'));
    await db.query('RESET ROLE');await db.query("CREATE FUNCTION pg_temp.fail_d4b_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_d4b_audit BEFORE INSERT ON public.action_audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_d4b_audit()");
    await asOwner();const a=(await db.query("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'Audit failure fixture','risk_mitigation') RETURNING to_jsonb(actions) AS value",[own.user_id])).rows[0].value;
    await denied("SELECT public.update_action_with_audit($1,$2,'{\"status\":\"completed\"}')",[own.user_id,a.id],'P0001');
    assert.deepEqual((await db.query('SELECT to_jsonb(a) AS value FROM public.actions a WHERE id=$1',[a.id])).rows[0].value,a);
  });
  stage='profile and Auth lifecycle';await fixture(async()=>{
    const fresh=await freshProfile();await asOwner(fresh.id);
    const a=(await db.query("INSERT INTO public.actions(user_id,name,goal_type,status) VALUES($1,'Lifecycle fixture','risk_mitigation','completed') RETURNING *",[fresh.id])).rows[0];
    await db.query('RESET ROLE');await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count) VALUES($1,'actions_created','2098-01-01','2098-02-01',8)",[fresh.id]);
    await denied('DELETE FROM auth.users WHERE id=$1',[fresh.id],'23503');await db.query('DELETE FROM public.business_profiles WHERE id=$1',[fresh.profile.id]);
    const detached=(await db.query('SELECT business_id,organization_id FROM public.actions WHERE id=$1',[a.id])).rows[0];assert.equal(detached.business_id,null);assert.equal(detached.organization_id,a.organization_id);
    await db.query('DELETE FROM public.usage_tracking WHERE user_id=$1',[fresh.id]);await db.query('DELETE FROM auth.users WHERE id=$1',[fresh.id]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.actions WHERE id=$1',[a.id])).rows[0].n,0);
  });
  stage='legacy forecast handoff';await fixture(async()=>{
    const fresh=await freshProfile();await db.query('SET LOCAL ROLE service_role');
    const draft=(await db.query("SELECT public.begin_cash_forecast_draft($1,$2,'USD','2098-01-01','2098-01-01',1000,0,0,NULL,'d4b-fixture','{}') AS value",[fresh.id,fresh.profile.id])).rows[0].value;
    await db.query("INSERT INTO public.actions(user_id,name,goal_type,status,linked_forecast_version_id) VALUES($1,'Linked draft fixture','risk_mitigation','completed',$2)",[fresh.id,draft.version_id]);
    assert.equal((await db.query('SELECT public.discard_cash_forecast_draft($1,$2,$3) AS value',[fresh.id,draft.version_id,draft.updated_at])).rows[0].value.reason,'linked_action');
  });
  assert.deepEqual(await fingerprint(),stable);await db.query('ROLLBACK');
  assert.deepEqual(await fingerprint(args.includes('--rehearse')),before);console.log('PASS: owner/service action/history, populated quota decisions, late-audit rollback, profile/Auth lifecycle and draft-link compatibility; all fixtures rolled back.');
  if(!args.includes('--rehearse')){
    stage='independent-session capacity lock';const peer=new Client(config);await peer.connect();
    try{
      await peer.query('BEGIN');await peer.query('SELECT user_id FROM public.subscriptions WHERE user_id=$1 FOR NO KEY UPDATE',[own.user_id]);
      await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");await asOwner();
      const writer=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,blocker=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const attempt=db.query("INSERT INTO public.actions(user_id,name,goal_type) VALUES($1,'Capacity contention rollback fixture','risk_mitigation') RETURNING organization_id",[own.user_id]).then(value=>({value}),error=>({error}));
      let blocked=false;const deadline=Date.now()+3000;while(Date.now()<deadline){blocked=(await peer.query('SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked',[blocker,writer])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,30));}
      assert.equal(blocked,true);await peer.query('ROLLBACK');const result=await attempt;assert.equal(result.error,undefined);assert.equal(result.value.rows[0].organization_id,own.organization_id);await db.query('ROLLBACK');
      console.log('PASS: legacy action admission still waits on the authoritative subscription lock and completes after release; both transactions rolled back.');
      stage='independent-session profile deletion';
      const removable=(await db.query('SELECT p.id,p.user_id FROM public.business_profiles p WHERE p.user_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM public.cash_forecasts f WHERE f.business_id=p.id) ORDER BY p.id LIMIT 1',[users])).rows[0];
      assert.ok(removable,'One dedicated account without retained plans is required');
      await db.query('BEGIN');await asOwner(removable.user_id);
      await db.query("INSERT INTO public.actions(user_id,name,goal_type,status) VALUES($1,'Profile contention rollback fixture','risk_mitigation','completed')",[removable.user_id]);
      await peer.query('BEGIN');await peer.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
      const writerPid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,deletePid=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const deleting=peer.query('DELETE FROM public.business_profiles WHERE id=$1',[removable.id]).then(value=>({value}),error=>({error}));
      let deleteBlocked=false;const deleteDeadline=Date.now()+3000;
      while(Date.now()<deleteDeadline){deleteBlocked=(await db.query('SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked',[writerPid,deletePid])).rows[0].blocked;if(deleteBlocked)break;await new Promise(r=>setTimeout(r,30));}
      assert.equal(deleteBlocked,true);await db.query('ROLLBACK');const deleted=await deleting;assert.equal(deleted.error,undefined);
      assert.equal((await peer.query('SELECT count(*)::int AS n FROM public.actions WHERE user_id=$1 AND business_id IS NOT NULL',[removable.user_id])).rows[0].n,0);
      await peer.query('ROLLBACK');console.log('PASS: profile deletion waits for the action profile reference, then detaches existing links; both sessions rolled back.');
    }finally{await db.query('ROLLBACK').catch(()=>{});await peer.query('ROLLBACK').catch(()=>{});await peer.end();}
  }else assert.equal((await db.query("SELECT to_regclass('organization_private.action_scope_repairs') AS ledger")).rows[0].ledger,null);
  assert.deepEqual(await fingerprint(args.includes('--rehearse')),before);console.log('D4B preview verification complete; no production changes.');
}catch(error){console.error(`D4B preview check failed at ${stage} (${error.code??'validation'}); row details and credentials omitted.`);process.exitCode=1;}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
