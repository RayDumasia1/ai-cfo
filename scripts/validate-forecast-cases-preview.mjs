import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const connectionString=process.env.PREVIEW_DATABASE_URL,account=process.env.PREVIEW_TEST_ACCOUNT_A,other=process.env.PREVIEW_TEST_ACCOUNT_B;
if(!connectionString||!account||!other||account===other)throw new Error('Configure preview database and two dedicated test accounts.');
const url=new URL(connectionString);
const ref=url.hostname.startsWith('db.')?url.hostname.split('.')[1]:decodeURIComponent(url.username).split('.')[1];
if(!ref||ref!==process.env.PREVIEW_PROJECT_REF||(!url.hostname.endsWith('.supabase.co')&&!url.hostname.endsWith('.supabase.com')))throw new Error('Preview project reference does not match the connection.');
const make=()=>new Client({connectionString,connectionTimeoutMillis:15000,application_name:'forecast-01e5-preview-validation'});
const a=make(),b=make();
const sql=name=>readFileSync(new URL(`../docs/migrations/${name}.sql`,import.meta.url),'utf8');
try{
  await a.connect();await b.connect();
  const installed=(await a.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_forecast_versions' AND column_name='case_request_key') AS present")).rows[0].present;
  if(!installed){if(!process.argv.includes('--apply'))throw new Error('Migration missing; use --apply for the reviewed preview migration.');
    await a.query(sql('2026-10-27-retained-forecast-cases'));console.log('Applied E5 retained forecast cases migration to preview.');}
  a.on('notice',n=>{if(n.message.startsWith('PASS:'))console.log(n.message);});
  await a.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)",[account,other]);
  await a.query(sql('verify-retained-forecast-cases'));
  const row=(await a.query("SELECT v.id,f.business_id FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id AND f.user_id=v.user_id WHERE v.user_id=$1 AND v.case_type='base' AND v.status='published' AND f.archived_at IS NULL LIMIT 1",[account])).rows[0];
  assert.ok(row,'Dedicated test account needs a current published base.');
  await a.query('BEGIN');await a.query('SELECT id FROM public.business_profiles WHERE id=$1 FOR UPDATE',[row.business_id]);
  await b.query("BEGIN; SET LOCAL ROLE service_role; SET LOCAL lock_timeout='1s'");
  async function waitProbe(query,params,checkBase=false){
    await b.query('SAVEPOINT contention');
    const waiting=b.query(query,params).then(()=>({success:true}),error=>({success:false,error}));
    try{
      if(checkBase){
        await new Promise(resolve=>setTimeout(resolve,150));
        // A Core revision waiting on the business must not already hold its
        // base lock: this detects the old version -> business lock inversion.
        await a.query('SELECT id FROM public.cash_forecast_versions WHERE id=$1 FOR UPDATE NOWAIT',[row.id]);
      }
      const outcome=await waiting;
      assert.equal(outcome.success,false,'Probe unexpectedly bypassed the shared lock.');
      assert.equal(outcome.error?.code,'55P03','Probe failed for a reason other than the expected lock timeout.');
    }finally{await b.query('ROLLBACK TO SAVEPOINT contention; RELEASE SAVEPOINT contention');}
  }
  await waitProbe("SELECT public.begin_core_forecast_revision($1,$2,current_date,current_date,1000,400)",[account,row.id],true);
  await waitProbe("SELECT public.save_cash_forecast_case($1,$2,'downside','Contention probe',gen_random_uuid(),'[]','{}','{}',current_date)",[account,row.id]);
  await b.query('ROLLBACK');await a.query('ROLLBACK');
  console.log('PASS: independent Core and case writers wait on the business lock without inverting the base-version lock; all probes rolled back.');
  console.log('E5 preview database validation complete. Production unchanged.');
}catch(error){console.error(`E5 preview verification failed (${error.code??'assertion'}): ${String(error.message).replaceAll(connectionString,'[redacted]')}`);process.exitCode=1;}
finally{await Promise.allSettled([a.query('ROLLBACK'),b.query('ROLLBACK')]);await Promise.allSettled([a.end(),b.end()]);}
