// ORG-01D3. Preview only. --rehearse rolls D3 DDL back; --apply installs once.
// The principal-race check briefly commits an unverified flag on one dedicated
// preview user, then restores its exact timestamp in a separate transaction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { previewConnection } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
const args=process.argv.slice(2);
if(args.length>1||args.some(v=>!['--apply','--rehearse'].includes(v)))throw new Error('Use --apply, --rehearse or no arguments');
const users=[process.env.PREVIEW_TEST_ACCOUNT_A,process.env.PREVIEW_TEST_ACCOUNT_B];
if(users.some(v=>!v)||users[0]===users[1])throw new Error('Two dedicated preview accounts required');
const config={connectionString:previewConnection(process.env),connectionTimeoutMillis:15000,application_name:'org-01d3-owner-authority-preview'};
const db=new Client(config);let stage='connect';let rehearsing=false;
const month={month_date:'2098-10-01',data_contract_version:2,source_type:'spreadsheet',accounting_basis:'cash',reporting_currency:'USD',period_status:'complete',
  opening_included_cash:1000,closing_included_cash:1100,closing_unavailable_cash:0,cash_collected_from_customers:500,operating_cash_paid:400,
  owner_draws_paid:0,debt_principal_paid:0,debt_interest_paid:0,investing_cash_paid:0,investing_cash_received:0,debt_funding_received:0,
  owner_funding_received:0,other_cash_inflows:0,other_cash_outflows:0};
async function fingerprint(){
  const result={};for(const {tablename} of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){
    if(!/^[a-z][a-z0-9_]*$/.test(tablename))throw new Error('Unexpected catalog identifier');
    result[tablename]=(await db.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM public.${tablename} t`)).rows[0];
  }return result;
}
async function asOwner(user=users[0]){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await db.query('SET LOCAL ROLE authenticated');}
async function denied(sql,values=[],code='42501'){
  await db.query('SAVEPOINT deny');try{await assert.rejects(db.query(sql,values),e=>e.code===code);}finally{await db.query('ROLLBACK TO SAVEPOINT deny; RELEASE SAVEPOINT deny');}
}
async function operation(op,org=null,months=[month],token=null){
  return(await db.query("SELECT public.owned_monthly_operation($1,$2,$3::jsonb,'{}','replace_all','check.xlsx',$4) AS value",[op,org,JSON.stringify(months),token])).rows[0].value;
}
async function fixture(run){
  await db.query('SAVEPOINT fixture');try{await run();}finally{await db.query('ROLLBACK TO SAVEPOINT fixture; RELEASE SAVEPOINT fixture');await db.query('RESET ROLE');}
}
try{
  await db.connect();const before=await fingerprint();
  const mappings=(await db.query("SELECT l.organization_id,l.current_business_profile_id AS profile_id,l.legacy_user_id AS user_id,p.data_version FROM public.legacy_account_organizations l JOIN public.business_profiles p ON p.id=l.current_business_profile_id WHERE l.legacy_user_id=ANY($1::uuid[]) AND l.state='live'",[users])).rows;
  assert.equal(mappings.length,2);const owner=mappings.find(m=>m.user_id===users[0]),foreign=mappings.find(m=>m.user_id===users[1]);
  const installed=(await db.query("SELECT to_regprocedure('public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid)') IS NOT NULL AS installed")).rows[0].installed;
  const migration=readFileSync(new URL('../docs/migrations/2026-10-29-organization-monthly-write-authority.sql',import.meta.url),'utf8');
  if(args.includes('--rehearse')){
    assert.equal(installed,false,'Rehearsal requires the D2 baseline');rehearsing=true;stage='DDL rehearsal';
    await db.query('BEGIN');await db.query(migration.replace(/\nBEGIN;\r?\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n'));
  }else{
    if(!installed){if(!args.includes('--apply'))throw new Error('Reviewed D3 migration required');stage='migration';await db.query(migration);console.log('Installed D3 in preview.');}
    await db.query('BEGIN');
  }
  stage='catalog closure';
  const legacy=['public.replace_financial_import(uuid,jsonb,jsonb,text)','public.import_financial_data(uuid,jsonb,jsonb,text,text)',
    'public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)','public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)',
    'public.financial_import_review_state(uuid)','public.financial_import_v2_is_unchanged(uuid,jsonb,jsonb,text)',
    'public.clear_financial_data(uuid)','public.clear_financial_data_preserving_settings(uuid)'];
  for(const role of ['anon','authenticated','service_role'])for(const signature of legacy)assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature])).rows[0].allowed,false);
  for(const table of ['financial_months','expense_categories','data_imports','financial_data_revisions'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') AS allowed",[role,`public.${table}`])).rows[0].allowed,false);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_table_privilege($1,'organization_private.monthly_write_events','SELECT,INSERT,UPDATE,DELETE') AS allowed",[role])).rows[0].allowed,false);
  assert.deepEqual(await fingerprint(),before);console.log('PASS: legacy engine execution, raw monthly DML and private audit privileges closed; all preexisting public fields unchanged.');
  stage='persisted-scope read parity';await fixture(async()=>{
    for(const mapping of [owner,foreign]){
      await db.query('RESET ROLE');const expected=(await db.query('SELECT to_jsonb(f) AS row FROM public.financial_months f WHERE user_id=$1 ORDER BY month_date DESC',[mapping.user_id])).rows.map(r=>r.row);
      await asOwner(mapping.user_id);
      const response=(await db.query('SELECT public.read_owned_financial_months($1,NULL) AS value',[mapping.organization_id])).rows[0].value;
      assert.equal(response.state,'ready');assert.deepEqual(response.months,expected);
      assert.deepEqual((await db.query('SELECT to_jsonb(f) AS row FROM public.financial_months f ORDER BY month_date DESC')).rows.map(r=>r.row),expected);
    }
  });console.log('PASS: both owners retain exact C RPC and direct SELECT RLS monthly parity with persisted organization scope.');
  stage='owner/scope preflight';await fixture(async()=>{
    await asOwner();assert.equal((await operation('authorize',owner.organization_id)).actorId,owner.user_id);
    await denied("SELECT public.owned_monthly_operation('review',$1,$2::jsonb)",[foreign.organization_id,JSON.stringify([month])],'P0002');
    await denied("INSERT INTO public.data_imports(user_id,import_type,status) VALUES($1,'manual','error')",[owner.user_id]);
    await denied("UPDATE public.business_profiles SET min_cash_reserve=99 WHERE user_id=$1",[owner.user_id]);
  });
  stage='review/import/no-op/clear';await fixture(async()=>{
    await asOwner();const review=await operation('review',owner.organization_id);assert.equal(review.context.actorId,owner.user_id);
    await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','bad.xlsx',$3)",[owner.organization_id,JSON.stringify([month]),'f'.repeat(32)],'P0001');
    await operation('confirm',owner.organization_id,[month],review.reviewState.state_version);
    const next=await operation('review',owner.organization_id);assert.equal(next.unchanged,true);
    await db.query('RESET ROLE');const exact=await fingerprint();const events=(await db.query('SELECT count(*)::int AS n FROM organization_private.monthly_write_events')).rows[0].n;
    await asOwner();await operation('confirm',owner.organization_id,[month],next.reviewState.state_version);
    await db.query('RESET ROLE');assert.deepEqual(await fingerprint(),exact);assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.monthly_write_events')).rows[0].n,events);
    await asOwner();await operation('clear',owner.organization_id);
    await db.query('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int AS n FROM public.financial_months WHERE user_id=$1',[owner.user_id])).rows[0].n,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM organization_private.monthly_write_events WHERE actor_reference=$1 AND operation='clear'",[owner.user_id])).rows[0].n,1);
  });console.log('PASS: authenticated scope denial, reviewed commit, stale state, semantic no-op and attributable Clear Data; fixture rolled back.');
  stage='settings/bootstrap';await fixture(async()=>{
    await asOwner();const profile=(await db.query("SELECT public.update_owned_business_profile('{\"business_name\":\"D3 fixture\",\"min_cash_reserve\":0}',$1) AS profile",[owner.organization_id])).rows[0].profile;
    assert.equal(profile.business_name,'D3 fixture');assert.equal(profile.user_id,owner.user_id);
    assert.equal((await db.query("SELECT public.update_owned_profile_preferences('7d',true)->>'success' AS value")).rows[0].value,'true');
    await db.query('RESET ROLE');const completed=(await db.query('SELECT onboarding_completed_at::text AS value FROM public.business_profiles WHERE user_id=$1',[owner.user_id])).rows[0].value;await asOwner();
    await db.query("SELECT public.update_owned_profile_preferences('data_reload',true)");await db.query('RESET ROLE');
    assert.equal((await db.query('SELECT onboarding_completed_at::text AS value FROM public.business_profiles WHERE user_id=$1',[owner.user_id])).rows[0].value,completed);await asOwner();
    await denied("SELECT public.update_owned_business_profile('{\"data_version\":\"forged\"}')",[],'22023');await db.query('RESET ROLE');
    const fresh=randomUUID();await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[fresh]);await asOwner(fresh);
    const created=(await db.query('SELECT public.ensure_owned_business_profile() AS profile')).rows[0].profile;assert.equal(created.user_id,fresh);
    await db.query('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[fresh]);
  });
  stage='legacy service closure/profile locks';await fixture(async()=>{
    await db.query('SET LOCAL ROLE service_role');
    await db.query('SELECT id FROM public.business_profiles WHERE user_id=$1 FOR UPDATE',[owner.user_id]);
    await denied('SELECT public.clear_financial_data($1)',[owner.user_id]);
    await denied('UPDATE public.financial_months SET closing_cash=999 WHERE user_id=$1',[owner.user_id]);
    await denied("UPDATE public.business_profiles SET business_name='bypass' WHERE user_id=$1",[owner.user_id]);
    // Full old draft RPC, rather than only a synthetic profile lock.
    const draft=(await db.query("SELECT public.begin_cash_forecast_draft($1,$2,'USD','2098-10-01','2098-10-01',1000,0,0,$3,'d3-compatibility','{}') AS value",[owner.user_id,owner.profile_id,owner.data_version])).rows[0].value;
    assert.ok(draft.version_id);
  });
  stage='late audit failure';await fixture(async()=>{
    await db.query("CREATE FUNCTION pg_temp.fail_d3_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event failure'; END $$; CREATE TRIGGER fail_d3_event BEFORE INSERT ON organization_private.monthly_write_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_d3_event()");
    await asOwner();const review=await operation('review',owner.organization_id);
    await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','new.xlsx',$3)",[owner.organization_id,JSON.stringify([month]),review.reviewState.state_version],'P0001');
    assert.equal((await operation('review',owner.organization_id)).reviewState.state_version,review.reviewState.state_version);
  });console.log('PASS: owner settings/bootstrap, Auth deletion, service lock compatibility and late-attribution failure rollback.');
  assert.deepEqual(await fingerprint(),before);await db.query('ROLLBACK');
  if(rehearsing){assert.equal((await db.query("SELECT to_regclass('organization_private.monthly_write_events') AS table_name")).rows[0].table_name,null);console.log('PASS: rehearsal DDL and all fixtures rolled back; D2 permissions remain installed.');}
  else{
    stage='profile-first contention';const peer=new Client(config);await peer.connect();
    try{
      await peer.query('BEGIN');await peer.query('SELECT id FROM public.business_profiles WHERE id=$1 FOR UPDATE',[owner.profile_id]);
      await db.query('BEGIN');await asOwner();await denied("SELECT public.owned_monthly_operation('review',$1,$2::jsonb)",[owner.organization_id,JSON.stringify([month])],'55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
      console.log('PASS: legacy profile-first contention fails promptly with 55P03; no deadlock or financial write.');
      await peer.query('BEGIN');await peer.query('SELECT user_id FROM public.subscriptions WHERE user_id=$1 FOR UPDATE',[owner.user_id]);
      await db.query('BEGIN');await asOwner();await denied("SELECT public.owned_monthly_operation('review',$1,$2::jsonb)",[owner.organization_id,JSON.stringify([month])],'55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
      console.log('PASS: concurrent billing row updates produce bounded contention without bypassing target entitlement.');
    }finally{await db.query('ROLLBACK').catch(()=>{});await peer.query('ROLLBACK').catch(()=>{});await peer.end();}
    stage='verification revocation while waiting';const revoker=new Client(config);await revoker.connect();let original;let mustRestore=false;
    try{
      original=(await revoker.query('SELECT email_confirmed_at::text AS email_confirmed_at FROM auth.users WHERE id=$1',[owner.user_id])).rows[0].email_confirmed_at;assert.ok(original);
      await revoker.query('BEGIN');await revoker.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE',[owner.organization_id]);
      const rootPid=(await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");await asOwner();
      const writerPid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const attempt=operation('review',owner.organization_id).then(value=>({value}),error=>({error}));
      let blocked=false;const deadline=Date.now()+3000;
      while(Date.now()<deadline){blocked=(await revoker.query('SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked',[rootPid,writerPid])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,50));}
      assert.equal(blocked,true);mustRestore=true;await revoker.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[owner.user_id]);await revoker.query('COMMIT');
      const result=await attempt;assert.equal(result.error?.code,'42501');await db.query('ROLLBACK');
      console.log('PASS: a verified writer queued on the root rechecks principal state and denies access after verification revocation.');
    }finally{
      await db.query('ROLLBACK').catch(()=>{});await revoker.query('ROLLBACK').catch(()=>{});
      if(mustRestore){await revoker.query('UPDATE auth.users SET email_confirmed_at=$1 WHERE id=$2',[original,owner.user_id]);
        assert.equal((await revoker.query('SELECT email_confirmed_at::text AS value FROM auth.users WHERE id=$1',[owner.user_id])).rows[0].value,original);}
      await revoker.end();
    }
  }
  assert.deepEqual(await fingerprint(),before);console.log('D3 preview checks complete; no production changes and public financial/profile/billing row values preserved.');
}catch(error){console.error(`D3 preview check failed at ${stage} (${error.code??'validation'}); details/credentials omitted.`);process.exitCode=1;}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
