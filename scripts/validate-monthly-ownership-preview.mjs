// ORG-01D2 preview-only install and rollback fixtures. Never run in production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { previewConnection, readOnlyPlan } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
if (process.argv.slice(2).some(v => v !== '--apply')) throw new Error('Use optional --apply only');
const users = [process.env.PREVIEW_TEST_ACCOUNT_A, process.env.PREVIEW_TEST_ACCOUNT_B];
if (users.some(u => !u) || users[0] === users[1]) throw new Error('Two dedicated preview accounts required');
const config = { connectionString: previewConnection(process.env), connectionTimeoutMillis: 15000, application_name: 'org-01d2-monthly-storage-preview' };
const db = new Client(config);
const targets = ['financial_months','expense_categories','data_imports','financial_data_revisions'];
let stage = 'connect';
async function fingerprint(client = db) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(tablename)) throw new Error('Unexpected table name');
    const row = targets.includes(tablename) ? "to_jsonb(t)-'organization_id'" : 'to_jsonb(t)';
    result[tablename] = (await client.query(`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(md5((${row})::text),'' ORDER BY md5((${row})::text)),'')) AS digest FROM public.${tablename} t`)).rows[0];
  }
  return result;
}
async function stableFingerprint() {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { return await fingerprint(); } finally { await db.query('ROLLBACK'); }
}
async function denied(sql, args, code) {
  await db.query('SAVEPOINT denied');
  try { await assert.rejects(db.query(sql,args), e => e.code === code); }
  finally { await db.query('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied'); }
}
async function state(user) { return (await db.query("SELECT public.financial_import_review_state($1)->>'state_version' AS state", [user])).rows[0].state; }
const month = { month_date:'2098-10-01',data_contract_version:2,source_type:'spreadsheet',accounting_basis:'cash',reporting_currency:'USD',period_status:'complete',
  opening_included_cash:1000,closing_included_cash:1100,closing_unavailable_cash:0,cash_collected_from_customers:500,operating_cash_paid:400,
  owner_draws_paid:0,debt_principal_paid:0,debt_interest_paid:0,investing_cash_paid:0,investing_cash_received:0,debt_funding_received:0,
  owner_funding_received:0,other_cash_inflows:0,other_cash_outflows:0 };
try {
  await db.connect(); stage='prerequisites';
  const plan=await readOnlyPlan(db); assert.equal(plan.installed,true); assert.equal(plan.unmapped,0); assert.equal(plan.conflicting_mappings,0);
  const before=await stableFingerprint();
  const beforePolicy=(await db.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname", [targets])).rows;
  const beforeReview=await state(users[0]);
  const installed=(await db.query("SELECT to_regclass('organization_private.financial_scopes') IS NOT NULL AS installed")).rows[0].installed;
  if (!installed) {
    if (!process.argv.includes('--apply')) throw new Error('Reviewed D2 migration required');
    stage='migration'; await db.query(readFileSync(new URL('../docs/migrations/2026-10-29-organization-monthly-ownership.sql',import.meta.url),'utf8'));
    console.log('Applied D2 ownership expansion to preview.');
    if (Number(before.financial_months.count)+Number(before.expense_categories.count)>0) assert.notEqual(await state(users[0]),beforeReview);
  }
  stage='catalog and preservation';
  assert.deepEqual(await stableFingerprint(),before);
  assert.deepEqual((await db.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname", [targets])).rows,beforePolicy);
  for (const table of targets) {
    assert.equal((await db.query(`SELECT count(*)::int AS invalid FROM public.${table} t LEFT JOIN organization_private.financial_scopes s
      ON s.organization_id=t.organization_id AND s.legacy_user_id=t.user_id WHERE s.organization_id IS NULL`)).rows[0].invalid,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2 AND contype='f' AND convalidated",[`public.${table}`,`${table}_organization_owner_fk`])).rows[0].n,1);
  }
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("SELECT has_schema_privilege($1,'organization_private','USAGE') AS allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_table_privilege($1,'organization_private.financial_scopes','SELECT,INSERT,UPDATE,DELETE') AS allowed",[role])).rows[0].allowed,false);
    for (const helper of ['guard_financial_scope','provision_financial_scope','guard_monthly_ownership']) assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed',[role,`organization_private.${helper}()`])).rows[0].allowed,false);
  }
  console.log('PASS: all preexisting public-row fields preserved; current policies unchanged; validated ownership FKs and private grants.');
  const mappings=(await db.query("SELECT legacy_user_id,organization_id,current_business_profile_id AS profile_id FROM public.legacy_account_organizations WHERE legacy_user_id=ANY($1::uuid[]) AND state='live'",[users])).rows;
  assert.equal(mappings.length,2);
  for (const owner of mappings) {
    stage='C owner parity'; const foreign=mappings.find(x=>x.legacy_user_id!==owner.legacy_user_id);
    const raw=(await db.query('SELECT to_jsonb(t) AS row FROM public.financial_months t WHERE user_id=$1 ORDER BY month_date DESC',[owner.legacy_user_id])).rows.map(x=>x.row);
    await db.query('BEGIN READ ONLY'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner.legacy_user_id]); await db.query('SET LOCAL ROLE authenticated');
    const read=(await db.query('SELECT public.read_owned_financial_months($1,NULL) AS value',[owner.organization_id])).rows[0].value;
    assert.equal(read.state,'ready'); assert.deepEqual(read.months,raw);
    await denied('SELECT public.read_owned_financial_months($1,NULL)',[foreign.organization_id],'P0002');
    await denied('SELECT * FROM organization_private.financial_scopes',[],'42501'); await db.query('ROLLBACK');
  }
  console.log('PASS: both authenticated C owners retain exact monthly parity; foreign selections and scope-table reads denied.');
  const owner=mappings[0],foreign=mappings[1];
  stage='scope guards'; await db.query('BEGIN'); await db.query('SET LOCAL ROLE service_role');
  await denied("INSERT INTO public.data_imports(user_id,import_type,status,organization_id) VALUES($1,'manual','error',$2)",[owner.legacy_user_id,foreign.organization_id],'23514');
  await denied('UPDATE public.financial_months SET organization_id=$1 WHERE user_id=$2',[foreign.organization_id,owner.legacy_user_id],'23514');
  await denied('UPDATE public.financial_months SET business_id=NULL WHERE user_id=$1',[owner.legacy_user_id],'23514');
  await db.query('ROLLBACK');
  stage='real imports and no-op'; await db.query('BEGIN');
  await db.query("INSERT INTO public.expense_categories(user_id,business_id,month_date,category,amount) VALUES($1,$2,'2098-09-01','D2 verification',0)",[owner.legacy_user_id,owner.profile_id]);
  await db.query('SET LOCAL ROLE service_role');
  const token=await state(owner.legacy_user_id);
  const call="SELECT public.import_reviewed_financial_data($1,$2::jsonb,'{}','d2-check.xlsx','replace_all',$3) AS value";
  stage='reviewed v2 import'; await db.query(call,[owner.legacy_user_id,JSON.stringify([month]),token]);
  stage='no-op fingerprint';
  await db.query('RESET ROLE'); const exact=await fingerprint(); await db.query('SET LOCAL ROLE service_role'); const next=await state(owner.legacy_user_id);
  const noop=(await db.query(call,[owner.legacy_user_id,JSON.stringify([month]),next])).rows[0].value;
  assert.equal(noop.unchanged,true); await db.query('RESET ROLE'); assert.deepEqual(await fingerprint(),exact); await db.query('SET LOCAL ROLE service_role'); assert.equal(await state(owner.legacy_user_id),next);
  const snapshot=(await db.query('SELECT months_snapshot,categories_snapshot FROM public.financial_data_revisions WHERE user_id=$1 ORDER BY id DESC LIMIT 1',[owner.legacy_user_id])).rows[0];
  assert.ok(snapshot.months_snapshot.every(m=>m.organization_id===owner.organization_id));
  assert.ok(snapshot.categories_snapshot.every(c=>c.organization_id===owner.organization_id));
  await db.query("SELECT public.replace_financial_import($1,$2::jsonb,'{}','legacy-check.csv')",[owner.legacy_user_id,JSON.stringify([{month_date:'2098-10-01',closing_cash:0,total_revenue:0,total_expenses:0}])]);
  await db.query("SELECT public.import_financial_data($1,$2::jsonb,'{}','update-check.csv','update_months')",[owner.legacy_user_id,JSON.stringify([{month_date:'2098-11-01',closing_cash:20}])]);
  await db.query('SELECT public.clear_financial_data($1)',[owner.legacy_user_id]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.financial_months WHERE user_id=$1',[owner.legacy_user_id])).rows[0].n,0);
  await db.query('ROLLBACK'); console.log('PASS: populated categories/revisions, v2 reviewed import/no-op, legacy aliases, update-months and Clear Data; fixture rolled back.');
  stage='late failure rollback'; await db.query('BEGIN');
  await db.query("CREATE FUNCTION pg_temp.fail_d2_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'D2 late failure'; END $$; CREATE TRIGGER fail_d2_audit BEFORE INSERT ON public.data_imports FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_d2_audit()");
  const initial=await fingerprint(); await db.query('SET LOCAL ROLE service_role');
  await denied("SELECT public.import_financial_data_v2($1,$2::jsonb,'{}','fail.xlsx','replace_all')",[owner.legacy_user_id,JSON.stringify([month])],'P0001');
  await db.query('RESET ROLE'); assert.deepEqual(await fingerprint(),initial); await db.query('ROLLBACK');
  stage='new profile and Auth deletion'; await db.query('BEGIN'); const fresh=randomUUID();
  await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[fresh]); await db.query('SET LOCAL ROLE service_role');
  await db.query("SELECT public.import_financial_data_v2($1,$2::jsonb,'{}','first.xlsx','replace_all')",[fresh,JSON.stringify([month])]);
  await db.query('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[fresh])).rows[0].n,1);
  const browserUser=randomUUID(); await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[browserUser]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[browserUser]); await db.query('SET LOCAL ROLE authenticated');
  const browserProfile=(await db.query('INSERT INTO public.business_profiles(user_id) VALUES($1) RETURNING id',[browserUser])).rows[0].id;
  assert.ok(browserProfile); await db.query('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM organization_private.financial_scopes WHERE legacy_user_id=$1',[browserUser])).rows[0].n,1);
  await db.query('DELETE FROM auth.users WHERE id=$1',[browserUser]);
  await db.query('DELETE FROM auth.users WHERE id=$1',[fresh]);
  for (const table of targets) assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table} WHERE user_id=$1`,[fresh])).rows[0].n,0);
  await db.query('ROLLBACK'); console.log('PASS: late-failure atomicity, authenticated INSERT RETURNING, first-import B+D2 provisioning and Auth deletion; fixtures rolled back.');
  stage='profile deletion concurrency';
  // Use the existing owner without a forecast graph; preserve every row by
  // rolling back BOTH transactions. Do not create committed/tombstoned fixtures.
  const removable=(await db.query("SELECT p.id,p.user_id FROM public.business_profiles p WHERE p.user_id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM public.cash_forecasts f WHERE f.business_id=p.id) ORDER BY p.id LIMIT 1",[users])).rows[0];
  assert.ok(removable,'A dedicated owner without retained plans is required for the rollback deletion check');
  const peer=new Client(config); await peer.connect();
  try {
    const writerPid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const peerPid=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await db.query('BEGIN'); await db.query("SET LOCAL statement_timeout='10s'");
    await db.query('UPDATE public.financial_months SET notes=notes WHERE user_id=$1',[removable.user_id]);
    await peer.query('BEGIN'); await peer.query("SET LOCAL statement_timeout='10s'");
    let completed=false; const deletion=peer.query('DELETE FROM public.business_profiles WHERE id=$1',[removable.id]).then(r=>{completed=true;return r;});
    // Attach rejection immediately so a timeout cannot become unhandled.
    const outcome=deletion.then(value=>({value}),error=>({error}));
    let blocked=false; const deadline=Date.now()+3000;
    while(Date.now()<deadline && !completed) {
      blocked=(await db.query('SELECT $1::int=ANY(pg_blocking_pids($2)) AS blocked',[writerPid,peerPid])).rows[0].blocked;
      if(blocked) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(blocked,true); assert.equal(completed,false);
    await db.query('ROLLBACK'); const result=await outcome; if(result.error) throw result.error;
    assert.equal(result.value.rowCount,1);
    assert.equal((await peer.query('SELECT count(*)::int AS n FROM public.financial_months WHERE user_id=$1 AND business_id IS NOT NULL',[removable.user_id])).rows[0].n,0);
    await peer.query('ROLLBACK');
  } finally { await db.query('ROLLBACK').catch(()=>{}); await peer.query('ROLLBACK').catch(()=>{}); await peer.end(); }
  assert.deepEqual(await stableFingerprint(),before);
  console.log('PASS: independent-session profile deletion waits for the financial writer, then completes without ownership loss; all public row values restored.');
  console.log('ORG-01D2 preview validation complete. Production migration and owner smoke acceptance remain separate.');
} catch(error) { console.error(`ORG-01D2 preview failed at ${stage} (${error.code??'validation'}); details/credentials omitted.`);
  const permission=/^permission denied for (?:table|schema|function) [a-z_][a-z_0-9]*$/i.test(error.message??'');
  if(permission) console.error(error.message);
  process.exitCode=1; }
finally { await db.query('ROLLBACK').catch(()=>{}); await db.end().catch(()=>{}); }
