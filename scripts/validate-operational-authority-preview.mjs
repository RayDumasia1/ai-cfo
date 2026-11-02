// D4C preview only. --rehearse rolls DDL and fixtures back; --apply installs once.
// Concurrent final-slot probes briefly commit operator-created test slots/window,
// then remove only tracked fixture IDs and restore exact original billing fields.
// They create no committed attribution events; the waiting authenticated call denies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {previewConnection} from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');const args=process.argv.slice(2);
if(args.length>1||args.some(v=>!['--apply','--rehearse'].includes(v)))throw new Error('Use --apply, --rehearse or no arguments');
const users=[process.env.PREVIEW_TEST_ACCOUNT_A,process.env.PREVIEW_TEST_ACCOUNT_B];if(users.some(v=>!v)||users[0]===users[1])throw new Error('Two dedicated preview accounts required');
const config={connectionString:previewConnection(process.env),connectionTimeoutMillis:15000,application_name:'org-01d4c-authority-preview'};
const db=new Client(config);let stage='connect';
const sql=readFileSync(new URL('../docs/migrations/2026-11-01-organization-action-authority.sql',import.meta.url),'utf8');
async function fingerprint(){const result={};for(const {tablename} of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){
  if(!/^[a-z][a-z0-9_]*$/.test(tablename))throw new Error('Unexpected catalog identifier');result[tablename]=(await db.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM public.${tablename} t`)).rows[0];}return result;}
async function asActor(client=db,user=users[0]){await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await client.query('SET LOCAL ROLE authenticated');}
async function denied(query,values=[],code='42501'){await db.query('SAVEPOINT deny');try{await assert.rejects(db.query(query,values),e=>e.code===code);}finally{await db.query('ROLLBACK TO SAVEPOINT deny; RELEASE SAVEPOINT deny');}}
async function fixture(run){await db.query('SAVEPOINT fixture');try{await run();}finally{await db.query('ROLLBACK TO SAVEPOINT fixture; RELEASE SAVEPOINT fixture');await db.query('RESET ROLE');}}
async function action(op,id=null,patch={},org=null){return(await db.query('SELECT public.owned_action_operation($1,$2,$3,$4::jsonb) AS value',[op,org,id,JSON.stringify(patch)])).rows[0].value;}
async function quota(op='consume',metric='ask_cfo_questions',org=null){return(await db.query('SELECT public.owned_usage_operation($1,$2,$3) AS value',[op,metric,org])).rows[0].value;}
async function blockedBy(observer,blocker,writer){const until=Date.now()+3000;while(Date.now()<until){if((await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked',[blocker,writer])).rows[0].blocked)return true;await new Promise(r=>setTimeout(r,30));}return false;}
try{
  await db.connect();await db.query("SET statement_timeout='20s'; SET lock_timeout='5s'");const before=await fingerprint();
  const mappings=(await db.query(`SELECT l.organization_id,l.current_business_profile_id AS profile_id,l.legacy_user_id AS user_id,s.feature_tier,
    s.status IN('active','pending_cancellation') AND (s.stripe_subscription_id IS NOT NULL OR s.plan<>'starter') AS eligible
    FROM public.legacy_account_organizations l JOIN public.subscriptions s ON s.user_id=l.legacy_user_id WHERE l.legacy_user_id=ANY($1::uuid[]) AND l.state='live'`,[users])).rows;
  assert.equal(mappings.length,2);const own=mappings.find(m=>m.user_id===users[0]),foreign=mappings.find(m=>m.user_id===users[1]);
  const installed=(await db.query("SELECT to_regprocedure('public.owned_action_operation(text,uuid,uuid,jsonb,text,uuid)') IS NOT NULL AS installed")).rows[0].installed;
  if(args.includes('--rehearse')){assert.equal(installed,false,'Rehearsal requires D4B');stage='DDL rehearsal';await db.query('BEGIN');await db.query(sql.replace(/\nBEGIN;\r?\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n'));}
  else{if(!installed){assert.ok(args.includes('--apply'),'Reviewed D4C migration required');stage='migration';await db.query(sql);console.log('Installed D4C in preview.');}await db.query('BEGIN');}
  stage='privilege closure';assert.deepEqual(await fingerprint(),before);
  for(const role of ['anon','authenticated','service_role']){
    for(const table of ['actions','action_audit_log','usage_tracking']){
      assert.equal((await db.query("SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed",[role,`public.${table}`])).rows[0].allowed,false);
      assert.equal((await db.query("SELECT has_any_column_privilege($1,$2,'INSERT,UPDATE,REFERENCES') AS allowed",[role,`public.${table}`])).rows[0].allowed,false);
    }
    for(const signature of ['public.update_action_with_audit(uuid,uuid,jsonb,text)','public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)','public.increment_usage(uuid,text,timestamptz,timestamptz,integer)','public.get_active_action_count(uuid)']){
      if((await db.query('SELECT to_regprocedure($1) IS NOT NULL AS present',[signature])).rows[0].present)assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature])).rows[0].allowed,false);
    }
    assert.equal((await db.query("SELECT has_table_privilege($1,'organization_private.operational_write_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role])).rows[0].allowed,false);
  }
  console.log('PASS: raw/column writes, TRUNCATE/TRIGGER and legacy action/quota execution closed; original public rows unchanged.');
  stage='owner read parity';await fixture(async()=>{
    for(const m of mappings){await db.query('RESET ROLE');const raw=(await db.query('SELECT to_jsonb(a) AS row FROM public.actions a WHERE user_id=$1 ORDER BY created_at DESC',[m.user_id])).rows.map(v=>v.row);await asActor(db,m.user_id);
      const read=await action('list',null,{},m.organization_id);assert.deepEqual([...read.actions].sort((a,b)=>a.id.localeCompare(b.id)),[...raw].sort((a,b)=>a.id.localeCompare(b.id)));
      assert.equal((await action('count')).count,raw.filter(v=>v.status!=='completed').length);
      const other=m.user_id===own.user_id?foreign:own;await denied("SELECT public.owned_action_operation('list',$1)",[other.organization_id],'P0002');}
  });
  stage='action/status/delete attribution';await fixture(async()=>{
    await asActor();const created=await action('create',null,{name:'D4C rollback fixture',goal_type:'risk_mitigation'});const id=created.action.id;
    await action('update',id,{status:'completed'});assert.equal((await action('history',id)).history.length,1);await action('delete',id);assert.equal((await action('get',id)).action,null);
    await db.query('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.operational_write_events WHERE resource_reference=$1',[id])).rows[0].n,3);
    await denied('DELETE FROM organization_private.operational_write_events WHERE resource_reference=$1',[id],'55000');
    await db.query('SET LOCAL ROLE service_role');await denied("SELECT public.update_action_with_audit($1,$2,'{}')",[own.user_id,id]);await denied('DELETE FROM public.actions WHERE user_id=$1',[own.user_id]);
  });
  stage='quota decisions and warnings';await fixture(async()=>{
    await db.query("UPDATE public.subscriptions SET feature_tier='core',status='active',billing_period_start=clock_timestamp()-interval '1 day',billing_period_end=clock_timestamp()+interval '29 days' WHERE user_id=$1",[own.user_id]);
    await db.query("INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit) SELECT user_id,'ask_cfo_questions',billing_period_start,billing_period_end,19,20 FROM public.subscriptions WHERE user_id=$1",[own.user_id]);
    await asActor();assert.equal((await quota()).count,20);const denial=await quota();assert.equal(denial.allowed,false);assert.equal(denial.count,20);
    assert.ok((await quota('status')).usage.some(v=>v.metric==='actions_active'));
    await db.query('RESET ROLE');await db.query("UPDATE public.subscriptions SET feature_tier='growth' WHERE user_id=$1",[own.user_id]);
    await db.query("UPDATE public.usage_tracking u SET count=150 FROM public.subscriptions s WHERE u.user_id=s.user_id AND u.user_id=$1 AND u.metric='ask_cfo_questions' AND u.period_start=s.billing_period_start",[own.user_id]);
    await asActor();const over=await quota();assert.equal(over.count,151);assert.equal(over.throttled,true);
    await db.query("SELECT public.owned_usage_operation('mark_warning','ask_cfo_questions',NULL,$1)",[over.periodStart]);
    assert.equal((await quota('consume','ai_insight_runs')).usage_limit,null);
  });
  stage='late private audit rollback';await fixture(async()=>{
    await asActor();const created=await action('create',null,{name:'Late attribution rollback',goal_type:'risk_mitigation'});await db.query('RESET ROLE');
    await db.query("CREATE FUNCTION pg_temp.fail_operation_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_operation_event BEFORE INSERT ON organization_private.operational_write_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_operation_event()");
    await asActor();await denied("SELECT public.owned_action_operation('update',NULL,$1,'{\"status\":\"completed\"}')",[created.action.id],'P0001');assert.equal((await action('get',created.action.id)).action.status,'not_started');
  });
  stage='forecast and retained attribution lifecycle';await fixture(async()=>{
    const fresh=randomUUID();await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[fresh]);await asActor(db,fresh);const p=(await db.query('SELECT public.ensure_owned_business_profile() AS value')).rows[0].value;
    await db.query('RESET ROLE');await db.query('SET LOCAL ROLE service_role');const draft=(await db.query("SELECT public.begin_cash_forecast_draft($1,$2,'USD','2098-01-01','2098-01-01',1000,0,0,NULL,'d4c-fixture','{}') AS value",[fresh,p.id])).rows[0].value;
    await db.query('RESET ROLE');await asActor(db,fresh);const made=await action('create',null,{name:'Linked completed fixture',goal_type:'risk_mitigation',status:'completed',linked_forecast_version_id:draft.version_id});
    await db.query('RESET ROLE');await db.query('SET LOCAL ROLE service_role');assert.equal((await db.query('SELECT public.discard_cash_forecast_draft($1,$2,$3) AS value',[fresh,draft.version_id,draft.updated_at])).rows[0].value.reason,'linked_action');
    await db.query('RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=$1',[fresh]);assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.operational_write_events WHERE resource_reference=$1',[made.action.id])).rows[0].n,1);
  });
  assert.deepEqual(await fingerprint(),before);await db.query('ROLLBACK');console.log('PASS: owner/foreign read parity, action/history/delete attribution, quota denial/overage/unlimited, rollback and legacy forecast/Auth lifecycle; fixtures rolled back.');
  if(!args.includes('--rehearse')){
    const peer=new Client(config);await peer.connect();await peer.query("SET statement_timeout='20s'; SET lock_timeout='5s'");
    try{
      for(const [name,query,key] of [['profile','SELECT id FROM public.business_profiles WHERE id=$1 FOR UPDATE',own.profile_id],['billing','SELECT user_id FROM public.subscriptions WHERE user_id=$1 FOR NO KEY UPDATE',own.user_id]]){
        stage=`${name}-first contention`;await peer.query('BEGIN');await peer.query(query,[key]);await db.query('BEGIN');await asActor();await denied("SELECT public.owned_action_operation('create',NULL,NULL,'{\"name\":\"Busy fixture\",\"goal_type\":\"risk_mitigation\"}')",[],'55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
      }
      const version=(await peer.query('SELECT v.id,v.user_id FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id JOIN public.business_profiles p ON p.id=f.business_id AND p.user_id=v.user_id WHERE v.user_id=ANY($1::uuid[]) ORDER BY v.id LIMIT 1',[users])).rows[0];assert.ok(version,'A dedicated forecast version is required');
      stage='version-first contention';await peer.query('BEGIN');await peer.query('SELECT id FROM public.cash_forecast_versions WHERE id=$1 FOR UPDATE',[version.id]);await db.query('BEGIN');await asActor(db,version.user_id);
      await denied("SELECT public.owned_action_operation('create',NULL,NULL,$1::jsonb)",[JSON.stringify({name:'Version contention fixture',goal_type:'risk_mitigation',linked_forecast_version_id:version.id})],'55P03');await db.query('ROLLBACK');await peer.query('ROLLBACK');
      console.log('PASS: profile/billing/version-first writers produce bounded NOWAIT contention without reversed lock waits.');
      const finite=mappings.find(m=>m.eligible&&m.feature_tier==='core');assert.ok(finite,'An eligible Core dedicated account is required');
      // Winner uses operator DML under the same reviewed locks; no immutable
      // attribution fixture is committed. The waiting authenticated RPC denies.
      stage='committed final action slot';const ids=[];let pending;
      try{
        await peer.query('BEGIN');await peer.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[finite.user_id]);await peer.query('SELECT organization_private.lock_operational_owner($1,true,false)',[finite.organization_id]);
        const capacity=finite.feature_tier==='starter'?10:50,current=(await peer.query("SELECT count(*)::int AS n FROM public.actions WHERE organization_id=$1 AND status<>'completed'",[finite.organization_id])).rows[0].n;assert.ok(current<capacity);
        await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");await asActor(db,finite.user_id);
        const blocker=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,writer=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=action('create',null,{name:'Competing slot rollback fixture',goal_type:'risk_mitigation'},finite.organization_id).then(value=>({value}),error=>({error}));assert.equal(await blockedBy(peer,blocker,writer),true);
        for(let i=current;i<capacity;i++){const id=randomUUID();ids.push(id);await peer.query("INSERT INTO public.actions(id,user_id,name,goal_type) VALUES($1,$2,'Operator slot fixture','risk_mitigation')",[id,finite.user_id]);}
        await peer.query('COMMIT');const result=await pending;assert.equal(result.error?.code,'P0001');assert.equal(result.error?.message,'action_limit_reached');await db.query('ROLLBACK');
      }finally{await peer.query('ROLLBACK').catch(()=>{});if(pending)await pending;await db.query('ROLLBACK').catch(()=>{});if(ids.length)await peer.query('DELETE FROM public.actions WHERE id=ANY($1::uuid[])',[ids]);}
      console.log('PASS: the authenticated action writer waited for the root, saw a preceding committed final-slot admission and denied without a partial write; tracked operator fixtures removed.');
      stage='committed final quota slot';let original,periodStart,counterId;pending=undefined;
      try{
        assert.equal((await peer.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='public.subscriptions'::regclass AND NOT tgisinternal AND tgname<>'preserve_founding_member_identity'")).rows[0].n,0,'Review unexpected billing triggers before temporary window probe');
        original=(await peer.query('SELECT billing_period_start::text AS start,billing_period_end::text AS finish FROM public.subscriptions WHERE user_id=$1',[finite.user_id])).rows[0];
        assert.equal(finite.feature_tier,'core','Core dedicated account required for the 20-unit probe');
        await peer.query('BEGIN');await peer.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[finite.user_id]);await peer.query('SELECT organization_private.lock_operational_owner($1,true,false)',[finite.organization_id]);
        periodStart=(await peer.query("UPDATE public.subscriptions SET billing_period_start=clock_timestamp()-interval '1 day',billing_period_end=clock_timestamp()+interval '29 days' WHERE user_id=$1 RETURNING billing_period_start::text AS start",[finite.user_id])).rows[0].start;
        counterId=randomUUID();await peer.query("INSERT INTO public.usage_tracking(id,user_id,metric,period_start,period_end,count,usage_limit) SELECT $1,user_id,'ask_cfo_questions',billing_period_start,billing_period_end,19,20 FROM public.subscriptions WHERE user_id=$2",[counterId,finite.user_id]);
        await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");await asActor(db,finite.user_id);
        const blocker=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,writer=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=quota('consume','ask_cfo_questions',finite.organization_id).then(value=>({value}),error=>({error}));assert.equal(await blockedBy(peer,blocker,writer),true);
        const winner=(await peer.query("SELECT public.consume_usage(user_id,'ask_cfo_questions',billing_period_start,billing_period_end,20,false) AS value FROM public.subscriptions WHERE user_id=$1",[finite.user_id])).rows[0].value;assert.equal(winner.count,20);await peer.query('COMMIT');
        const result=await pending;assert.equal(result.error,undefined);assert.equal(result.value.allowed,false);assert.equal(result.value.count,20);await db.query('ROLLBACK');
      }finally{
        await peer.query('ROLLBACK').catch(()=>{});if(pending)await pending;await db.query('ROLLBACK').catch(()=>{});
        if(counterId)await peer.query('DELETE FROM public.usage_tracking WHERE id=$1',[counterId]);
        if(original&&periodStart){await peer.query('UPDATE public.subscriptions SET billing_period_start=$1,billing_period_end=$2 WHERE user_id=$3',[original.start,original.finish,finite.user_id]);}
      }
      console.log('PASS: the authenticated quota writer saw the preceding committed count of 20 and denied at 20; temporary counter removed and exact billing window restored.');
      stage='verification revocation while queued';let verified,restore=false;pending=undefined;
      try{
        verified=(await peer.query('SELECT email_confirmed_at::text AS stamp FROM auth.users WHERE id=$1',[own.user_id])).rows[0].stamp;assert.ok(verified);
        await peer.query('BEGIN');await peer.query('SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE',[own.organization_id]);
        await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");await asActor();
        const blocker=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,writer=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=action('create',null,{name:'Revoked rollback fixture',goal_type:'risk_mitigation'}).then(value=>({value}),error=>({error}));assert.equal(await blockedBy(peer,blocker,writer),true);
        restore=true;await peer.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[own.user_id]);await peer.query('COMMIT');assert.equal((await pending).error?.code,'42501');await db.query('ROLLBACK');
      }finally{await peer.query('ROLLBACK').catch(()=>{});if(pending)await pending;await db.query('ROLLBACK').catch(()=>{});if(restore){await peer.query('UPDATE auth.users SET email_confirmed_at=$1 WHERE id=$2',[verified,own.user_id]);assert.equal((await peer.query('SELECT email_confirmed_at::text AS stamp FROM auth.users WHERE id=$1',[own.user_id])).rows[0].stamp,verified);}}
      console.log('PASS: the queued writer rechecked principal verification after root release and denied revoked access; exact Auth timestamp restored.');
    }finally{await peer.query('ROLLBACK').catch(()=>{});await db.query('ROLLBACK').catch(()=>{});await peer.end();}
  }else assert.equal((await db.query("SELECT to_regclass('organization_private.operational_write_events') AS ledger")).rows[0].ledger,null);
  assert.deepEqual(await fingerprint(),before);console.log('D4C preview checks complete; all original public row values preserved and no production changes.');
}catch(error){console.error(`D4C preview check failed at ${stage} (${error.code??'validation'}); raw details and credentials omitted.`);process.exitCode=1;}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
