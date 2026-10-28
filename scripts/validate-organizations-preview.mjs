// Canonical fixtures roll back. Multi-session commits use disposable, non-exposed
// schemas only, including an isolated Auth-parent table; real identities are never deleted.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { backfillOrganizations, legacyFingerprint, previewConnection, readOnlyPlan, shadowTables } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
const connectionString = previewConnection(process.env);
const owner = process.env.PREVIEW_TEST_ACCOUNT_A, other = process.env.PREVIEW_TEST_ACCOUNT_B;
if (!owner || !other || owner === other) throw new Error('Configure two dedicated preview Auth accounts');
const make = () => new Client({ connectionString, connectionTimeoutMillis: 15000, application_name: 'org-01b-preview-verification' });
const a = make(), b = make(), observer = make();
const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const probe = `org01b_probe_${suffix}`, privateProbe = `org01b_private_${suffix}`, authProbe = `org01b_auth_${suffix}`, marker = `org01b-disposable:${suffix}`;
const rewrite = sql => sql.replaceAll('organization_private', privateProbe).replaceAll('public.', `${probe}.`).replaceAll("'public'", `'${probe}'`).replaceAll('auth.users', `${authProbe}.users`);
const run = (db, text, values = []) => db.query(rewrite(text), values.map(value =>
  typeof value === 'string' && /^public\.[a-z_]+$/.test(value) ? rewrite(value) : value));
const ensure = async (db, p, u) => (await run(db, 'SELECT public.ensure_legacy_organization($1::uuid,$2::uuid,$3::uuid) AS r', [p, u, randomUUID()])).rows[0].r;
const adapter = { query: (text, values) => run(a, text, values), end: () => a.end() };
let stage = 'connect';
const backendPids = new Map();
async function rootMetadata() {
  const result = {};
  for (const table of shadowTables) result[table] = (await observer.query(`SELECT count(*)::text AS count,
    md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM public.${table} t`)).rows[0];
  result.authIds = (await observer.query("SELECT count(*)::text AS count,md5(coalesce(string_agg(id::text,'' ORDER BY id),'')) AS digest FROM auth.users")).rows[0];
  return result;
}
async function waitForBlock(blocked, blocker) {
  const limit = Date.now() + 3000;
  while (Date.now() < limit) {
    const waiting = (await observer.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked', [backendPids.get(blocked), backendPids.get(blocker)])).rows[0].blocked;
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Expected independent-session blocking was not observed');
}
function outcome(promise) { return promise.then(value => ({ value }), error => ({ error })); }
async function begin(db) {
  await db.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
  // Pooler startup process IDs need not be PostgreSQL backend IDs. Read inside
  // the pinned transaction rather than relying on pg.Client.processID.
  backendPids.set(db, (await db.query('SELECT pg_backend_pid() AS id')).rows[0].id);
}
async function dropOwnedSchema(name) {
  assert.match(name, /^org01b_(probe|private|auth)_[a-f0-9]{16}$/);
  const record = (await observer.query("SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1", [name])).rows[0];
  if (!record) return;
  assert.equal(record.marker, marker, 'Refusing to drop a schema without this run marker');
  await observer.query(`DROP SCHEMA "${name}" CASCADE`);
}
try {
  await a.connect(); await b.connect(); await observer.connect();
  const installed = await readOnlyPlan(observer); assert.equal(installed.installed, true); assert.equal(installed.unmapped, 0);
  assert.equal((await observer.query('SELECT count(*)::int AS n FROM auth.users WHERE id=ANY($1::uuid[])', [[owner, other]])).rows[0].n, 2);
  const legacyBefore = await legacyFingerprint(observer), metadataBefore = await rootMetadata();
  stage = 'canonical rollback verifier';
  a.on('notice', n => { if (n.message.startsWith('PASS:')) console.log(n.message); });
  await a.query("SELECT set_config('app.preview_confirmed','true',false)");
  await a.query(readFileSync(new URL('../docs/migrations/verify-organization-shadow-storage.sql', import.meta.url), 'utf8'));
  stage = 'isolated fixture schema';
  // No real profile/Auth deletion. The only committed fixtures are in these
  // marked, random schemas; they are inaccessible to the application's API.
  await observer.query(`CREATE SCHEMA "${probe}"; COMMENT ON SCHEMA "${probe}" IS '${marker}'`);
  await observer.query(`CREATE SCHEMA "${authProbe}"; COMMENT ON SCHEMA "${authProbe}" IS '${marker}'; CREATE TABLE ${authProbe}.users(id uuid PRIMARY KEY)`);
  await observer.query(`INSERT INTO ${authProbe}.users(id) VALUES($1),($2)`, [owner, other]);
  await observer.query(`CREATE TABLE ${probe}.business_profiles(LIKE public.business_profiles INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
  await observer.query(`ALTER TABLE ${probe}.business_profiles ADD FOREIGN KEY(user_id) REFERENCES ${authProbe}.users(id) ON DELETE CASCADE`);
  await run(observer, `CREATE FUNCTION public.update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE TRIGGER trg_business_profiles_updated_at BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "business_profiles: own rows" ON public.business_profiles TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)`);
  const p = randomUUID(), q = randomUUID();
  await run(observer, 'INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2),($3,$4)', [p, owner, q, other]);
  // The exact new migration is namespace-rewritten; no older migration or
  // canonical function is reinstalled. Its constraints/trigger bodies stay intact.
  await observer.query(rewrite(readFileSync(new URL('../docs/migrations/2026-10-28-organization-shadow-storage.sql', import.meta.url), 'utf8')));
  await observer.query(`COMMENT ON SCHEMA "${privateProbe}" IS '${marker}'; GRANT USAGE ON SCHEMA "${probe}" TO service_role`);
  stage = 'concurrent initial ensure / commit';
  await begin(a); await begin(b);
  const first = await ensure(a, p, owner), waiting = outcome(ensure(b, p, owner));
  await waitForBlock(b, a); await a.query('COMMIT');
  const second = await waiting; assert.ifError(second.error); assert.deepEqual(second.value, { ...first, created: false }); await b.query('COMMIT');
  console.log('PASS: concurrent first ensure waits, then replays the one committed organization.');
  stage = 'concurrent initial ensure / rollback';
  await begin(a); await begin(b);
  const abandoned = await ensure(a, q, other), pending = outcome(ensure(b, q, other));
  await waitForBlock(b, a); await a.query('ROLLBACK');
  const winner = await pending; assert.ifError(winner.error); assert.equal(winner.value.created, true); assert.notEqual(winner.value.organization_id, abandoned.organization_id); await b.query('COMMIT');
  console.log('PASS: rolled-back first provision leaves no partial graph; the waiter creates exactly once.');
  stage = 'concurrent first profile upsert';
  await run(observer, 'DELETE FROM public.business_profiles WHERE id=$1', [p]);
  await begin(a); await begin(b);
  const newProfile = (await run(a, 'INSERT INTO public.business_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id', [owner])).rows[0].id;
  const competing = outcome(run(b, 'INSERT INTO public.business_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING id', [owner]));
  await waitForBlock(b, a); await a.query('COMMIT');
  const upserted = await competing; assert.ifError(upserted.error); assert.equal(upserted.value.rows[0].id, newProfile); await b.query('COMMIT');
  assert.equal((await ensure(observer, newProfile, owner)).created, false);
  console.log('PASS: simultaneous missing-profile upserts return one profile and its atomic shadow graph.');
  stage = 'delete wins against ensure';
  await begin(a); await begin(b); await run(a, 'DELETE FROM public.business_profiles WHERE id=$1', [newProfile]);
  const stale = outcome(ensure(b, newProfile, owner)); await waitForBlock(b, a); await a.query('COMMIT');
  assert.equal((await stale).error?.code, 'P0002'); await b.query('ROLLBACK');
  stage = 'ensure wins against delete';
  await begin(a); await begin(b); const retained = await ensure(a, q, other);
  const deletion = outcome(run(b, 'DELETE FROM public.business_profiles WHERE id=$1', [q]));
  await waitForBlock(b, a); await a.query('COMMIT'); assert.ifError((await deletion).error); await b.query('COMMIT');
  assert.equal((await run(observer, 'SELECT lifecycle FROM public.organizations WHERE id=$1', [retained.organization_id])).rows[0].lifecycle, 'archived');
  console.log('PASS: both deletion/ensure orderings serialize without regranting a deleted profile.');
  stage = 'interrupted backfill and insertion before cursor';
  await run(observer, `ALTER TABLE public.business_profiles DISABLE TRIGGER organization_profile_provisioned`);
  const low = '00000000-0000-4000-8000-000000000011', high = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  await run(observer, 'INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2),($3,$4)', [low, owner, high, other]);
  await run(observer, `ALTER TABLE public.business_profiles ENABLE TRIGGER organization_profile_provisioned`);
  await assert.rejects(backfillOrganizations(adapter, { batchSize: 1, onBatch: () => { throw new Error('intentional interruption'); } }), /intentional interruption/);
  assert.equal((await run(observer, 'SELECT count(*)::int AS n FROM public.legacy_account_organizations WHERE current_business_profile_id=$1', [high])).rows[0].n, 0);
  let inserted = false;
  const finished = await backfillOrganizations(adapter, { batchSize: 1, onBatch: async () => {
    if (inserted) return; inserted = true;
    // New lower UUID after progress: INSERT hook maps it independently of any cursor.
    await run(observer, 'DELETE FROM public.business_profiles WHERE id=$1', [low]);
    await run(observer, 'INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2)', ['00000000-0000-4000-8000-000000000001', owner]);
  } });
  assert.equal(finished.report.unmapped, 0); assert.equal(finished.report.active, 2);
  console.log('PASS: interrupted batches resume and a new profile before the old UUID cursor is mapped.');
  stage = 'Auth cascade races (isolated Auth parent only)';
  const currentProfile = (await run(observer, 'SELECT id FROM public.business_profiles WHERE user_id=$1', [owner])).rows[0].id;
  await begin(a); await begin(b); await a.query(`DELETE FROM ${authProbe}.users WHERE id=$1`, [owner]);
  const missingAfterAuth = outcome(ensure(b, currentProfile, owner)); await waitForBlock(b, a); await a.query('COMMIT');
  assert.equal((await missingAfterAuth).error?.code, 'P0002'); await b.query('ROLLBACK');
  await begin(a); await begin(b); await ensure(a, high, other);
  const authDeletion = outcome(b.query(`DELETE FROM ${authProbe}.users WHERE id=$1`, [other]));
  await waitForBlock(b, a); await a.query('COMMIT'); assert.ifError((await authDeletion).error); await b.query('COMMIT');
  await run(observer, 'SELECT organization_private.assert_shadow_organization(id) FROM public.organizations');
  assert.equal((await run(observer, "SELECT count(*)::int AS n FROM public.organizations WHERE lifecycle='active'")).rows[0].n, 0);
  console.log('PASS: both Auth-cascade/ensure orderings archive safely without touching real Auth users.');
  stage = 'fixture cleanup'; await dropOwnedSchema(probe); await dropOwnedSchema(privateProbe); await dropOwnedSchema(authProbe);
  stage = 'canonical preservation';
  assert.deepEqual(await legacyFingerprint(observer), legacyBefore); assert.deepEqual(await rootMetadata(), metadataBefore);
  console.log('PASS: canonical public rows, shadow records and Auth identities unchanged; disposable schemas removed.');
  console.log('ORG-01B preview verification complete. Production unchanged. Hosted owner navigation remains a separate acceptance check.');
} catch (error) {
  console.error(`ORG-01B preview verification failed at ${stage} (${error.code ?? 'assertion'}). SQL details and credentials omitted.`); process.exitCode = 1;
} finally {
  await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK'), observer.query('ROLLBACK')]);
  // Only drop our exact random names after verifying their ownership markers.
  for (const schema of [probe, privateProbe, authProbe]) {
    try { await dropOwnedSchema(schema); } catch { console.error('Fixture cleanup requires review of this run marker.'); process.exitCode = 1; }
  }
  await Promise.allSettled([a.end(), b.end(), observer.end()]);
}
