// ORG-01D1. Catalog and aggregate evidence only; no migration/backfill/fixtures.
// Never point this preview-only tool at production.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { previewConnection } from './organization-shadow-tools.mjs';

process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('Use optional --output <local-report.json> only');
const db = new Client({ connectionString: previewConnection(process.env), connectionTimeoutMillis: 15000,
  application_name: 'org-01d1-read-only-financial-inventory' });
const ident = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Unexpected catalog identifier');
  return `"${value}"`;
};
const scoped = name => /^(cash_|financial_|action_)/.test(name) || [
  'business_profiles', 'expense_categories', 'data_imports', 'actions', 'dismissed_alerts', 'subscriptions', 'usage_tracking',
].includes(name);
const digest = value => createHash('sha256').update(value).digest('hex');
let stage = 'connect';
try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'");
  if ((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw new Error('Read-only transaction required');
  stage = 'prerequisites';
  const prerequisites = (await db.query(`SELECT
    to_regprocedure('public.ensure_legacy_organization(uuid,uuid,uuid)') IS NOT NULL AS b_storage,
    to_regprocedure('public.read_owned_financial_months(uuid,integer)') IS NOT NULL AS c_reads,
    (SELECT count(*)::int FROM public.business_profiles p LEFT JOIN public.legacy_account_organizations l
      ON l.current_business_profile_id=p.id AND l.legacy_user_id=p.user_id AND l.state='live'
      WHERE l.organization_id IS NULL) AS unmapped_profiles`)).rows[0];
  if (!prerequisites.b_storage || !prerequisites.c_reads || prerequisites.unmapped_profiles) throw new Error('Complete B/C mapping prerequisites required');
  await db.query('SELECT organization_private.assert_shadow_organization(id) FROM public.organizations');
  stage = 'catalog';
  const relations = (await db.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'not_null',a.attnotnull,'generated',a.attgenerated) ORDER BY a.attnum) AS columns
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind='r' GROUP BY c.oid ORDER BY c.relname`)).rows.filter(t => scoped(t.name));
  const byName = new Map(relations.map(t => [t.name, t]));
  const names = [...byName.keys()];
  const has = (table, column) => byName.get(table)?.columns.some(c => c.name === column);
  const constraints = (await db.query(`SELECT c.conname AS name,c.conrelid::regclass::text AS child,
    CASE WHEN c.contype='f' THEN c.confrelid::regclass::text ELSE NULL END AS parent,
    c.contype AS kind,c.convalidated AS validated,pg_catalog.pg_get_constraintdef(c.oid) AS definition,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(id,pos)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.id ORDER BY k.pos) AS child_columns,
    ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(id,pos)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.id ORDER BY k.pos) AS parent_columns
    FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,c.conname`, [names])).rows;
  const policies = (await db.query(`SELECT tablename AS table_name,policyname,roles,cmd,qual,with_check
    FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname`, [names])).rows;
  const triggers = (await db.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
    t.tgfoid::regprocedure::text AS function_signature,pg_catalog.pg_get_triggerdef(t.oid) AS definition
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`, [names])).rows;
  const tablePrivileges = (await db.query(`SELECT c.relname AS table_name,r.role_name,
    jsonb_object_agg(v.privilege,has_table_privilege(r.role_name,c.oid,v.privilege)) AS privileges
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name)
    CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    GROUP BY c.relname,r.role_name ORDER BY c.relname,r.role_name`, [names])).rows;
  stage = 'ownership counts';
  for (const table of relations) {
    table.rows = Number((await db.query(`SELECT count(*)::text AS total FROM public.${ident(table.name)}`)).rows[0].total);
    if (!has(table.name, 'user_id')) { table.scope = { state: 'requires_parent_or_other_identity' }; continue; }
    const business = has(table.name, 'business_id');
    table.scope = (await db.query(`SELECT
      count(*) FILTER(WHERE t.user_id IS NULL)::int AS null_legacy_owner,
      count(*) FILTER(WHERE t.user_id IS NOT NULL AND p.id IS NULL)::int AS owner_without_profile,
      count(*) FILTER(WHERE p.id IS NOT NULL AND l.organization_id IS NULL)::int AS owner_without_live_mapping
      ${business ? `,count(*) FILTER(WHERE t.business_id IS NULL)::int AS null_business,
      count(*) FILTER(WHERE t.business_id IS NOT NULL AND (bp.id IS NULL OR bp.user_id IS DISTINCT FROM t.user_id))::int AS foreign_or_missing_business` : ''}
      FROM public.${ident(table.name)} t LEFT JOIN public.business_profiles p ON p.user_id=t.user_id
      LEFT JOIN public.legacy_account_organizations l ON l.current_business_profile_id=p.id AND l.legacy_user_id=t.user_id AND l.state='live'
      ${business ? 'LEFT JOIN public.business_profiles bp ON bp.id=t.business_id' : ''}`)).rows[0];
    table.scope.state = business ? 'legacy_owner_and_profile' : 'legacy_owner_only';
  }
  stage = 'parent edges';
  const edges = [];
  for (const c of constraints.filter(c => c.kind === 'f')) {
    const child = c.child.replace(/^public\./, ''), parent = c.parent.replace(/^public\./, '');
    if (!byName.has(child) || !byName.has(parent)) continue;
    const on = c.child_columns.map((v, i) => `child.${ident(v)}=parent.${ident(c.parent_columns[i])}`).join(' AND ');
    const complete = c.child_columns.map(v => `child.${ident(v)} IS NOT NULL`).join(' AND ');
    const tests = [`count(*) FILTER(WHERE ${complete} AND parent.${ident(c.parent_columns[0])} IS NULL)::int AS missing_parent`];
    if (has(child, 'user_id') && has(parent, 'user_id')) tests.push('count(*) FILTER(WHERE parent.user_id IS NOT NULL AND child.user_id IS DISTINCT FROM parent.user_id)::int AS foreign_legacy_owner');
    if (has(child, 'business_id') && has(parent, 'business_id')) tests.push('count(*) FILTER(WHERE parent.business_id IS NOT NULL AND child.business_id IS DISTINCT FROM parent.business_id)::int AS foreign_business');
    edges.push({ constraint: c.name, child, parent, ...(await db.query(`SELECT ${tests.join(',')} FROM public.${ident(child)} child
      LEFT JOIN public.${ident(parent)} parent ON ${on}`)).rows[0] });
  }
  stage = 'snapshot lineage';
  const snapshots = [];
  if (byName.has('financial_data_revisions')) for (const column of ['months_snapshot', 'categories_snapshot']) {
    if (!has('financial_data_revisions', column)) continue;
    snapshots.push({ table: 'financial_data_revisions', column, ...(await db.query(`SELECT count(*)::int AS embedded_rows,
      count(*) FILTER(WHERE e.value->>'user_id' IS DISTINCT FROM r.user_id::text)::int AS foreign_or_missing_legacy_owner,
      count(*) FILTER(WHERE e.value->>'business_id' IS NULL)::int AS missing_business,
      count(*) FILTER(WHERE e.value->>'business_id' IS NOT NULL AND e.value->>'business_id' IS DISTINCT FROM p.id::text)::int AS foreign_business
      FROM public.financial_data_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.${ident(column)}) e(value)
      LEFT JOIN public.business_profiles p ON p.user_id=r.user_id`)).rows[0] });
  }
  stage = 'function inventory';
  const functions = (await db.query(`SELECT p.oid::regprocedure::text AS signature,n.nspname AS schema,p.proname AS function_name,
    p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS configuration,
    pg_catalog.pg_get_functiondef(p.oid) AS definition,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','organization_private') AND p.prokind='f' ORDER BY n.nspname,p.proname`)).rows;
  const knownFunctions = new Set(functions.map(f => `${f.schema}.${f.function_name}`));
  const candidates = functions.map(({ definition, ...f }) => ({ ...f, definition_sha256: digest(definition),
    referenced_tables_text: names.filter(name => new RegExp(`\\b${name}\\b`, 'i').test(definition)),
    calls_text: [...new Set([...definition.matchAll(/\b(public|organization_private)\.([a-z][a-z0-9_]*)\s*\(/g)]
      .map(m => `${m[1]}.${m[2]}`).filter(name => knownFunctions.has(name) && name !== `${f.schema}.${f.function_name}`))],
    has_row_lock_text: /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(definition),
    has_dml_text: /\b(?:INSERT\s+INTO|UPDATE\s+(?:public\.)?[a-z_]|DELETE\s+FROM)\b/i.test(definition),
  }));
  const selected = new Set(candidates.filter(f => f.referenced_tables_text.length || f.schema === 'organization_private')
    .map(f => `${f.schema}.${f.function_name}`));
  // Include wrappers and callees so a service-only compatibility alias is not
  // missed merely because its body contains only another function call.
  for (let changed = true; changed;) {
    changed = false;
    for (const f of candidates) if (selected.has(`${f.schema}.${f.function_name}`) || f.calls_text.some(name => selected.has(name))) {
      for (const name of [`${f.schema}.${f.function_name}`, ...f.calls_text]) if (!selected.has(name)) { selected.add(name); changed = true; }
    }
  }
  const writers = candidates.filter(f => selected.has(`${f.schema}.${f.function_name}`));
  const report = { format: 'org-financial-inventory-1', environment: 'preview', captured_at: new Date().toISOString(),
    transaction: 'repeatable-read/read-only', prerequisites, relations, constraints, policies, triggers, table_privileges: tablePrivileges,
    parent_edges: edges, embedded_revision_snapshots: snapshots, functions: writers,
    limits: ['Definition-text references are candidate evidence, not a complete SQL dependency parser or lock-order proof.',
      'No payloads, credentials, account IDs or financial values are included. Row counts are a point-in-time inventory.',
      'No production inspection; no repair, grant, schema, or data mutation. Application writers require repository review.'] };
  await db.query('COMMIT');
  if (args[1]) writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ format: report.format, transaction: report.transaction,
    tables: relations.map(({ name, rows, scope }) => ({ name, rows, scope })),
    parent_edges: edges, embedded_revision_snapshots: snapshots, functions: writers.length,
    report_written: !!args[1], production_changes: false }, null, 2));
} catch (error) {
  console.error(`ORG-01D1 read-only inventory failed at ${stage} (${error.code ?? 'validation'}); details/credentials omitted.`);
  process.exitCode = 1;
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); }
