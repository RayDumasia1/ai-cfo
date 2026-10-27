// Usage: node scripts/validate-forecast-preview.mjs [--apply]
// Secrets are read locally and never printed. Requires preview-only configuration.
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.loadEnvFile('.env.local');
const connectionString = process.env.PREVIEW_DATABASE_URL;
const accountA = process.env.PREVIEW_TEST_ACCOUNT_A;
const accountB = process.env.PREVIEW_TEST_ACCOUNT_B;
if (!connectionString || !accountA || !accountB || accountA === accountB) {
  throw new Error('Set PREVIEW_DATABASE_URL and two dedicated PREVIEW_TEST_ACCOUNT_A / PREVIEW_TEST_ACCOUNT_B UUIDs in .env.local');
}
const url = new URL(connectionString);
const projectRef = url.hostname.startsWith('db.') ? url.hostname.split('.')[1] : decodeURIComponent(url.username).split('.')[1];
if (!projectRef || !url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.com')) {
  throw new Error('Expected a Supabase preview connection string');
}
// Explicit ref check prevents a mistyped connection from touching another project.
if (process.env.PREVIEW_PROJECT_REF !== projectRef) throw new Error('Set PREVIEW_PROJECT_REF to the confirmed preview project reference');
const makeClient = () => new Client({ connectionString, connectionTimeoutMillis: 15000,
  application_name: 'forecast-01e3-preview-validation' });
const a = makeClient();
const b = makeClient();
const sqlFile = name => readFileSync(new URL(`../docs/migrations/${name}.sql`, import.meta.url), 'utf8');
let healthy = false;
try {
  await a.connect(); await b.connect();
  const { rows } = await a.query('SELECT current_user, id FROM public.business_profiles WHERE user_id=$1', [accountA]);
  assert.equal(rows[0]?.current_user, 'postgres', 'Migration verification requires postgres');
  const business = rows[0].id;
  console.log(`Connected to confirmed preview project ${projectRef}.`);
  const installed = (await a.query("SELECT to_regclass('public.cash_forecast_reviews') AS installed")).rows[0].installed;
  if (!installed && process.argv.includes('--apply')) {
    await a.query(sqlFile('2026-10-27-forecast-variance-storage'));
    console.log('Applied FORECAST-01E3 migration in preview.');
  } else if (!installed) throw new Error('Migration missing. Run again with --apply to apply the reviewed preview migration.');
  a.on('notice', n => { if (n.message.startsWith('PASS:')) console.log(n.message); });
  await a.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)", [accountA, accountB]);
  await a.query(sqlFile('verify-forecast-variance-storage'));
  // Find an existing published plan only to exercise its writer lock. No review
  // is saved, and every contention probe is rolled back in its own connection.
  const versions = (await a.query("SELECT v.id FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id WHERE v.user_id=$1 AND f.business_id=$2 AND v.status IN ('published','superseded') LIMIT 1", [accountA,business])).rows;
  assert.ok(versions.length, 'Dedicated account A needs a published forecast for contention verification');
  const eventPayload = { reporting_currency: 'USD', cash_date: new Date().toISOString().slice(0,10),
    amount: 1, direction: 'inflow', category: 'other_cash_in', source_type: 'manual',
    source_connection: 'rollback-contention-verifier', source_event_id: randomUUID(),
    ingestion_batch: 'verification', payload_fingerprint: 'contention-1', lineage: {}, manual_entry: true };
  await a.query('BEGIN');
  // The real ingestion function acquires and holds its business-row lock.
  const probe = (await a.query('SELECT public.record_cash_actual_event($1,$2,$3) AS value',
    [accountA,business,eventPayload])).rows[0].value.event_id;
  await b.query('BEGIN');
  await b.query("SET LOCAL ROLE service_role; SET LOCAL lock_timeout='1s'");
  async function mustWait(query, params) {
    await b.query('SAVEPOINT contention_probe');
    try { await assert.rejects(b.query(query,params), error => error.code === '55P03'); }
    finally { await b.query('ROLLBACK TO SAVEPOINT contention_probe; RELEASE SAVEPOINT contention_probe'); }
  }
  await mustWait('SELECT public.record_cash_actual_event($1,$2,$3)', [accountA,business,eventPayload]);
  await mustWait('SELECT public.save_cash_forecast_review($1,$2,current_date-14,gen_random_uuid(),$3,$4,$5,NULL,NULL,$6)', [accountA,versions[0].id,'contention-probe',[],{},{}]);
  await b.query('ROLLBACK');
  await a.query('ROLLBACK');
  assert.equal((await a.query('SELECT count(*)::int AS n FROM public.cash_actual_events WHERE id=$1', [probe])).rows[0].n, 0);
  console.log('PASS: two independent sessions serialize both ingestion and review saves on the business lock; probes rolled back.');
  healthy = true;
} catch (error) {
  // Avoid echoing connection strings, credentials or source payloads on failures.
  console.error(`Preview validation failed (${error.code ?? 'assertion'}): ${String(error.message).replaceAll(connectionString, '[redacted]')}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]);
  await Promise.allSettled([a.end(), b.end()]);
}
if (healthy) console.log('Preview FORECAST-01E3 validation complete. Production was not changed.');
