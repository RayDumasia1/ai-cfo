// Preview only: no Intuit calls, all connection/subscription fixtures roll back.
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const connectionString = process.env.PREVIEW_DATABASE_URL, account = process.env.PREVIEW_TEST_ACCOUNT_A, other = process.env.PREVIEW_TEST_ACCOUNT_B;
if (!connectionString || !account || !other || account === other) throw new Error('Configure preview database and two dedicated test accounts.');
const url = new URL(connectionString);
const ref = url.hostname.startsWith('db.') ? url.hostname.split('.')[1] : decodeURIComponent(url.username).split('.')[1];
if (!ref || ref !== process.env.PREVIEW_PROJECT_REF || (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.com'))) throw new Error('Preview project reference does not match the connection.');
const make = () => new Client({ connectionString, connectionTimeoutMillis: 15000, application_name: 'int-01b-preview-validation' });
const a = make(), b = make();
const sql = name => readFileSync(new URL(`../docs/migrations/${name}.sql`, import.meta.url), 'utf8');
try {
  await a.connect(); await b.connect();
  const present = (await a.query("SELECT to_regprocedure('public.quickbooks_lifecycle(uuid,uuid,text,jsonb)') IS NOT NULL AS present")).rows[0].present;
  if (!present) {
    if (!process.argv.includes('--apply')) throw new Error('Migration missing; use --apply for the reviewed preview migration.');
    await a.query(sql('2026-10-28-quickbooks-connection-lifecycle')); console.log('Applied INT-01B connection migration to preview.');
  }
  a.on('notice', n => { if (n.message.startsWith('PASS:')) console.log(n.message); });
  await a.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)", [account, other]);
  await a.query(sql('verify-quickbooks-connection-lifecycle'));
  const business = (await a.query('SELECT id FROM public.business_profiles WHERE user_id=$1', [account])).rows[0]?.id;
  assert.ok(business, 'Dedicated test account needs a business profile.');
  // Two independent sessions prove the shared workspace lock gates connection changes.
  await a.query('BEGIN'); await a.query('SELECT id FROM public.business_profiles WHERE id=$1 FOR UPDATE', [business]);
  await b.query("BEGIN; SET LOCAL ROLE service_role; SET LOCAL lock_timeout='1s'");
  const probe = await b.query("SELECT public.quickbooks_lifecycle($1,$2,'read')", [account, business]).then(() => null, error => error.code);
  assert.equal(probe, '55P03', 'Connection operation bypassed the shared workspace lock.');
  await b.query('ROLLBACK'); await a.query('ROLLBACK'); console.log('PASS: independent service session waits for the shared workspace lock.');
  // A real lifecycle mutation also holds the shared lock until commit/rollback.
  await a.query('BEGIN');
  await a.query("UPDATE public.subscriptions SET feature_tier='core',status='active',plan='core' WHERE user_id=$1", [account]);
  const pending = (await a.query("SELECT public.quickbooks_lifecycle($1,$2,'start',jsonb_build_object('stateHash',repeat('a',64),'browserHash',repeat('b',64))) AS c", [account, business])).rows[0].c;
  assert.equal(pending.status, 'authorizing');
  await b.query("BEGIN; SET LOCAL ROLE service_role; SET LOCAL lock_timeout='1s'");
  const blocked = await b.query("SELECT public.quickbooks_lifecycle($1,$2,'start',jsonb_build_object('stateHash',repeat('c',64),'browserHash',repeat('d',64)))", [account, business]).then(() => null, error => error.code);
  assert.equal(blocked, '55P03', 'Concurrent lifecycle mutation bypassed the workspace lock.');
  await b.query('ROLLBACK'); await a.query('ROLLBACK'); console.log('PASS: concurrent lifecycle mutation is serialized; all fixtures rolled back.');
  console.log('INT-01B preview database validation complete. Live Intuit authorization remains a separate check. Production unchanged.');
} catch (error) {
  // Never echo connection strings, SQL parameters or PostgreSQL error detail.
  const diagnostic = error.code === '42883' ? String(error.message).slice(0, 200) : error.code ? 'See the bounded verifier stage.' : String(error.message).replaceAll(connectionString, '[redacted]');
  console.error(`INT-01B preview validation failed (${error.code ?? 'assertion'}). ${diagnostic}`); process.exitCode = 1;
} finally {
  await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]); await Promise.allSettled([a.end(), b.end()]);
}
