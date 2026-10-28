// Preview-only operator: default is read-only. --apply [--install] provisions metadata.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { backfillOrganizations, batchSize, legacyFingerprint, previewConnection, readOnlyPlan } from './organization-shadow-tools.mjs';
process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
if (args.some(a => !['--plan', '--apply', '--install'].includes(a) && !/^--batch-size=\d+$/.test(a)) ||
  (args.includes('--plan') && args.includes('--apply')) || (args.includes('--install') && !args.includes('--apply'))) throw new Error('Use --plan or --apply [--install] [--batch-size=1..500]');
const limit = batchSize(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? 100);
const connectionString = previewConnection(process.env);
const db = new Client({ connectionString, connectionTimeoutMillis: 15000, application_name: 'org-01b-preview-backfill' });
let stage = 'connect';
try {
  await db.connect(); stage = 'read-only plan'; let plan = await readOnlyPlan(db);
  console.log('Preview shadow plan:', JSON.stringify(plan));
  if (args.includes('--apply')) {
    stage = 'legacy snapshot'; const before = await legacyFingerprint(db);
    if (!plan.installed) {
      if (!args.includes('--install')) throw new Error('Reviewed expansion must be installed first');
      stage = 'expansion'; await db.query(readFileSync(new URL('../docs/migrations/2026-10-28-organization-shadow-storage.sql', import.meta.url), 'utf8'));
      console.log('Installed ORG-01B expansion in preview.');
    }
    stage = 'backfill'; const result = await backfillOrganizations(db, { batchSize: limit });
    stage = 'legacy preservation'; assert.deepEqual(await legacyFingerprint(db), before, 'Legacy rows changed; inspect concurrent activity before claiming preservation.');
    plan = result.report; console.log('Preview shadow completion:', JSON.stringify(result));
    stage = 'exact replay'; const replay = await backfillOrganizations(db, { batchSize: limit });
    assert.equal(replay.created, 0); console.log('PASS: restart/replay creates no additional organization. Legacy row fingerprints unchanged.');
  }
} catch (error) {
  console.error(`ORG-01B operator failed at ${stage} (${error.code ?? 'validation'}). No SQL details or credentials printed.`); process.exitCode = 1;
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end().catch(() => {}); }
