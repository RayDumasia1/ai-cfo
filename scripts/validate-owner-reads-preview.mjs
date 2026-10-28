// ORG-01C: preview only. Operational policy install + read parity, with all
// lapse/verification fixtures rolled back. Never run against production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { legacyFingerprint, previewConnection, readOnlyPlan } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
if (process.argv.slice(2).some(a => a !== '--apply')) throw new Error('Use optional --apply only');
const users = [process.env.PREVIEW_TEST_ACCOUNT_A, process.env.PREVIEW_TEST_ACCOUNT_B];
if (users.some(u => !u) || users[0] === users[1]) throw new Error('Two dedicated preview accounts required');
const db = new Client({ connectionString: previewConnection(process.env), connectionTimeoutMillis: 15000, application_name: 'org-01c-owner-reads-preview' });
let stage = 'connect';
async function auth(user) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]); await db.query('SET LOCAL ROLE authenticated'); }
async function read(org = null, limit = null) {
  return (await db.query('SELECT public.read_owned_financial_months($1::uuid,$2::integer) AS value', [org, limit])).rows[0].value;
}
async function denied(action, code) {
  await db.query('SAVEPOINT denied');
  try { await assert.rejects(action, e => e.code === code); }
  finally { await db.query('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied'); }
}
try {
  await db.connect(); stage = 'B prerequisites'; const beforePlan = await readOnlyPlan(db);
  assert.equal(beforePlan.installed, true); assert.equal(beforePlan.unmapped, 0); assert.equal(beforePlan.conflicting_mappings, 0);
  const before = await legacyFingerprint(db);
  const installed = (await db.query("SELECT to_regprocedure('public.read_owned_financial_months(uuid,integer)') IS NOT NULL AS present")).rows[0].present;
  if (!installed) {
    if (!process.argv.includes('--apply')) throw new Error('C migration missing; reviewed --apply required');
    stage = 'read migration'; await db.query(readFileSync(new URL('../docs/migrations/2026-10-28-organization-owner-monthly-reads.sql', import.meta.url), 'utf8'));
    console.log('Applied ORG-01C owner monthly-read migration to preview.');
  }
  stage = 'owner parity';
  const ids = (await db.query('SELECT legacy_user_id,organization_id FROM public.legacy_account_organizations WHERE legacy_user_id=ANY($1::uuid[]) AND state=\'live\'', [users])).rows;
  assert.equal(ids.length, 2);
  for (const user of users) {
    const own = ids.find(r => r.legacy_user_id === user).organization_id;
    const foreign = ids.find(r => r.legacy_user_id !== user).organization_id;
    const original = (await db.query('SELECT to_jsonb(f) AS value FROM public.financial_months f WHERE user_id=$1 ORDER BY month_date DESC', [user])).rows.map(r => r.value);
    await db.query("BEGIN READ ONLY; SET LOCAL statement_timeout='15s'"); await auth(user);
    const selected = await read(own); assert.equal(selected.state, 'ready'); assert.equal(selected.context.actorId, user);
    assert.equal(selected.context.organizationId, own); assert.deepEqual(selected.months, original);
    assert.deepEqual(await read(), selected);
    assert.deepEqual((await db.query('SELECT to_jsonb(f) AS value FROM public.financial_months f ORDER BY month_date DESC')).rows.map(r => r.value), original);
    const list = (await db.query('SELECT public.list_owned_organizations() AS value')).rows[0].value;
    assert.equal(list.length, 1); assert.equal(list[0].id, own);
    await denied(() => read(foreign), 'P0002'); await denied(() => read(randomUUID()), 'P0002');
    await denied(() => db.query('SELECT * FROM public.organizations'), '42501');
    await db.query('ROLLBACK'); console.log(`PASS: owner RPC/default/explicit parity and direct RLS isolation (${original.length} months).`);
  }
  stage = 'lapsed workspace fixture';
  await db.query("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'");
  await db.query("UPDATE public.subscriptions SET status='cancelled' WHERE user_id=$1", [users[0]]); await auth(users[0]);
  assert.deepEqual(await read(), { state: 'subscription_required', context: null, months: [] });
  assert.equal((await db.query('SELECT id FROM public.financial_months')).rows.length, 0);
  assert.equal((await db.query('SELECT public.list_owned_organizations() AS value')).rows[0].value.length, 1);
  await db.query('ROLLBACK'); console.log('PASS: target subscription lapse denies monthly data, keeps owner discovery; fixture rolled back.');
  stage = 'unverified fixture';
  await db.query("BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'");
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1', [users[0]]); await auth(users[0]);
  await denied(() => read(), '42501'); assert.equal((await db.query('SELECT id FROM public.financial_months')).rows.length, 0);
  await db.query('ROLLBACK'); console.log('PASS: unverified RPC/direct monthly access denied; fixture rolled back.');
  stage = 'new profile compatibility';
  await db.query("BEGIN; SET LOCAL statement_timeout='15s'"); const fresh = randomUUID();
  await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())', [fresh]); await auth(fresh);
  assert.equal((await read()).state, 'profile_missing');
  const created = (await db.query('INSERT INTO public.business_profiles(user_id) VALUES($1) RETURNING id', [fresh])).rows[0];
  assert.ok(created.id); assert.equal((await read()).state, 'subscription_required');
  await db.query('ROLLBACK'); console.log('PASS: profile INSERT RETURNING and B provisioning stay compatible; no setup writes on reads.');
  stage = 'privilege/policy catalog';
  const policy = (await db.query("SELECT policyname,cmd FROM pg_policies WHERE schemaname='public' AND tablename='financial_months'")).rows;
  assert.deepEqual(policy, [{ policyname: 'financial_months_organization_owner_read', cmd: 'SELECT' }]);
  for (const signature of ['public.list_owned_organizations()', 'public.read_owned_financial_months(uuid,integer)', 'public.can_read_owned_financial_month(uuid,uuid)']) {
    const grants = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authed,has_function_privilege('service_role',$1,'EXECUTE') AS service", [signature])).rows[0];
    assert.deepEqual(grants, { anon: false, authed: true, service: false });
  }
  assert.deepEqual(await legacyFingerprint(db), before);
  console.log('PASS: replaced monthly policy and least-privilege RPC catalog; all preexisting public rows unchanged.');
  console.log('ORG-01C preview database validation complete. No production changes. Hosted owner acceptance remains separate.');
} catch (error) {
  console.error(`ORG-01C preview check failed at ${stage} (${error.code ?? 'assertion'}); details/credentials omitted.`); process.exitCode = 1;
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); }
