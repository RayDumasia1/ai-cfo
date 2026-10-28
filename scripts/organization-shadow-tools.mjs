// Internal operator helpers. No credentials or row payloads are logged here.
import { randomUUID } from 'node:crypto';
export const shadowTables = ['organizations', 'organization_memberships', 'legacy_account_organizations', 'organization_access_events'];
export function previewConnection(env) {
  const connectionString = env.PREVIEW_DATABASE_URL;
  if (!connectionString || !env.PREVIEW_PROJECT_REF) throw new Error('Preview database configuration required');
  const url = new URL(connectionString);
  const ref = url.hostname.startsWith('db.') ? url.hostname.split('.')[1] : decodeURIComponent(url.username).split('.')[1];
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !ref || ref !== env.PREVIEW_PROJECT_REF ||
    (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.com'))) throw new Error('Preview project mismatch');
  if (env.NEXT_PUBLIC_SUPABASE_URL && new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${ref}.supabase.co`) throw new Error('Application and preview project mismatch');
  return connectionString;
}
/** @param {unknown} [value] */
export function batchSize(value = 100) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error('Batch size must be an integer from 1 to 500');
  return n;
}
export async function installation(db) {
  const { rows } = await db.query(`SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])) AS tables,
    to_regprocedure('public.ensure_legacy_organization(uuid,uuid,uuid)') IS NOT NULL AS wrapper,
    (SELECT count(*)::int FROM pg_catalog.pg_trigger WHERE tgrelid='public.business_profiles'::regclass AND NOT tgisinternal
      AND tgname IN ('organization_profile_identity','organization_profile_provisioned') AND tgenabled='O') AS hooks`, [shadowTables]);
  const s = rows[0];
  if (s.tables === 0 && !s.wrapper && s.hooks === 0) return false;
  if (s.tables !== 4 || !s.wrapper || s.hooks !== 2) throw new Error('Partial shadow installation; review required');
  return true;
}
export async function shadowReport(db) {
  const installed = await installation(db);
  const summary = (await db.query(`SELECT (SELECT count(*)::int FROM public.business_profiles) AS profiles,
    (SELECT count(*)::int FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM public.business_profiles p WHERE p.user_id=u.id)) AS users_without_profiles`)).rows[0];
  const issues = {};
  for (const table of ['financial_months', 'expense_categories', 'actions', 'cash_forecasts', 'cash_actual_events']) {
    if (!(await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`])).rows[0].present) continue;
    issues[table] = (await db.query(`SELECT count(*) FILTER(WHERE t.business_id IS NULL)::int AS null_business,
      count(*) FILTER(WHERE t.business_id IS NOT NULL AND (p.id IS NULL OR p.user_id IS DISTINCT FROM t.user_id))::int AS conflicting_business
      FROM public.${table} t LEFT JOIN public.business_profiles p ON p.id=t.business_id`)).rows[0];
  }
  if (!installed) return { installed, ...summary, unmapped: summary.profiles, ownership_issues: issues };
  const counts = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.organizations WHERE lifecycle='active') AS active,
    (SELECT count(*)::int FROM public.organizations WHERE lifecycle='archived') AS archived,
    (SELECT count(*)::int FROM public.business_profiles p LEFT JOIN public.legacy_account_organizations l ON l.legacy_business_profile_id=p.id
      WHERE l.legacy_business_profile_id IS NULL) AS unmapped,
    (SELECT count(*)::int FROM public.business_profiles p JOIN public.legacy_account_organizations l ON l.legacy_business_profile_id=p.id
      WHERE l.state<>'live' OR l.current_business_profile_id IS DISTINCT FROM p.id OR l.legacy_user_id IS DISTINCT FROM p.user_id) AS conflicting_mappings
  `)).rows[0];
  // Runs under the trusted database operator, not through a newly exposed RPC.
  await db.query('SELECT organization_private.assert_shadow_organization(id) FROM public.organizations');
  return { installed, ...summary, ...counts, ownership_issues: issues };
}
export async function readOnlyPlan(db) {
  await db.query('BEGIN READ ONLY');
  try { await db.query("SET LOCAL statement_timeout='30s'"); return await shadowReport(db); }
  finally { await db.query('ROLLBACK'); }
}
export async function legacyFingerprint(db) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  try {
    await db.query("SET LOCAL statement_timeout='30s'");
    const tables = (await db.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND NOT(tablename=ANY($1::text[])) ORDER BY tablename`, [shadowTables])).rows;
    const result = {};
    for (const { tablename } of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(tablename)) throw new Error('Unexpected legacy table name');
      // MD5 is only a bounded row-comparison digest, never an authorization signature.
      result[tablename] = (await db.query(`SELECT count(*)::text AS count,
        md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM public.${tablename} t`)).rows[0];
    }
    return result;
  } finally { await db.query('ROLLBACK'); }
}
export async function backfillOrganizations(db, options = {}) {
  const limit = batchSize(options.batchSize ?? 100), operationId = options.operationId ?? randomUUID();
  const deadlineMs = options.deadlineMs ?? 60000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000) throw new Error('Invalid batch deadline');
  if (!await installation(db)) throw new Error('Install the reviewed expansion first');
  let created = 0, batches = 0, retries = 0;
  for (;;) {
    let attempt = 0, count = 0;
    for (;;) {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        // Closing a pg connection cancels its active query and rolls back its transaction.
        // Deadline termination is not retried on the closed connection; restart is idempotent.
        void db.end().catch(() => {});
      }, deadlineMs);
      try {
        await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await db.query("SET LOCAL lock_timeout='2s'");
        await db.query("SET LOCAL statement_timeout='30s'");
        const pending = (await db.query(`SELECT p.id,p.user_id FROM public.business_profiles p
          WHERE NOT EXISTS(SELECT 1 FROM public.legacy_account_organizations l WHERE l.legacy_business_profile_id=p.id)
          ORDER BY p.id LIMIT $1 FOR UPDATE OF p`, [limit])).rows;
        for (const p of pending) {
          if (expired) throw Object.assign(new Error('Batch deadline'), { code: 'ORG_BATCH_DEADLINE' });
          const r = (await db.query('SELECT public.ensure_legacy_organization($1::uuid,$2::uuid,$3::uuid) AS result', [p.id, p.user_id, operationId])).rows[0].result;
          if (r.created) count++;
        }
        if (expired) throw Object.assign(new Error('Batch deadline'), { code: 'ORG_BATCH_DEADLINE' });
        await db.query('COMMIT');
        created += count; if (pending.length) batches++;
        await options.onBatch?.({ created, batches, retries });
        if (!pending.length) {
          const report = await readOnlyPlan(db);
          if (report.unmapped !== 0 || report.conflicting_mappings !== 0 || report.active !== report.profiles) throw new Error('Shadow reconciliation incomplete');
          return { created, batches, retries, report };
        }
        break;
      } catch (error) {
        count = 0;
        if (!expired) await db.query('ROLLBACK');
        if (expired) throw Object.assign(new Error('Batch deadline; restart required'), { code: 'ORG_BATCH_DEADLINE' });
        if (!['55P03', '40P01', '40001'].includes(error.code) || attempt >= 3) throw error;
        attempt++; retries++;
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      } finally { clearTimeout(timer); }
    }
  }
}
