// D4A preview only. No --apply mode, fixtures, row payload output or mutations.
import { Client } from 'pg';
import { previewConnection } from './organization-shadow-tools.mjs';
import { actionOwnershipEvidenceSql,actionOwnershipPlan } from './organization-action-plan.mjs';
process.loadEnvFile('.env.local');
if(process.argv.length!==2)throw new Error('This read-only planner accepts no arguments');
const db=new Client({connectionString:previewConnection(process.env),connectionTimeoutMillis:15000,application_name:'org-01d4-read-only-action-plan'});
let stage='connect';
try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'");
  stage='prerequisites';
  const prerequisites=(await db.query(`SELECT current_setting('transaction_read_only')='on' AS read_only,
    to_regprocedure('public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid)') IS NOT NULL AS d3,
    to_regclass('organization_private.financial_scopes') IS NOT NULL AS d2`)).rows[0];
  if(!prerequisites.read_only||!prerequisites.d2||!prerequisites.d3)throw new Error('Complete preview D2/D3 prerequisites required');
  await db.query('SELECT organization_private.assert_shadow_organization(id) FROM public.organizations');
  stage='action and usage ownership';
  const report=actionOwnershipPlan((await db.query(actionOwnershipEvidenceSql)).rows[0].evidence);
  await db.query('ROLLBACK');
  console.log(JSON.stringify({...report,environment:'preview',transaction:'repeatable-read/read-only',production_changes:false},null,2));
  if(report.status==='BLOCKED')process.exitCode=1;
}catch(error){console.error(`D4 preview planning failed at ${stage} (${error.code??'validation'}); row details and credentials omitted.`);process.exitCode=1;}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
