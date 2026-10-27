import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { calculateForecastCase,type CaseAssumption,type CaseBase,type ForecastCaseType } from "../lib/forecastCases";
let db:PGlite,base:CaseBase,today:string;
const ids={owner:"11000000-0000-4000-8000-000000000001",other:"11000000-0000-4000-8000-000000000002",business:"22000000-0000-4000-8000-000000000001",
  forecast:"33000000-0000-4000-8000-000000000001",base:"44000000-0000-4000-8000-000000000001",receipt:"55000000-0000-4000-8000-000000000001",bill:"55000000-0000-4000-8000-000000000002"};
const sql=(name:string)=>readFileSync(new URL(`../docs/migrations/${name}.sql`,import.meta.url),"utf8");
const assumptions=():CaseAssumption[]=>[{id:randomUUID(),name:"Lower customer receipt",operation:"amount_multiplier",value:0.8,itemIds:[ids.receipt],rationale:"Customer expects to settle only part"},
  {id:randomUUID(),name:"Later customer receipt",operation:"date_shift_days",value:14,itemIds:[ids.receipt],rationale:"Collection may take two extra weeks"}];
async function save(a=assumptions(),key=randomUUID(),type:ForecastCaseType="downside",user=ids.owner,resultOverride?:unknown){
  const c=calculateForecastCase(base,a,today);
  const {rows}=await db.query<{value:{version_id:string;version_number:number;replayed:boolean}}>(
    "SELECT public.save_cash_forecast_case($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",[user,ids.base,type,"Collection timing case",key,JSON.stringify(a),JSON.stringify(resultOverride??c.caseResult),JSON.stringify(c.baseResult),today]);
  return rows[0].value;
}
async function rejects(operation:()=>Promise<unknown>,message:RegExp){
  await db.exec("SAVEPOINT probe");try{await expect(operation()).rejects.toThrow(message);}finally{await db.exec("ROLLBACK TO SAVEPOINT probe; RELEASE SAVEPOINT probe");}
}
describe("FORECAST-01E5 PostgreSQL case storage",()=>{
  beforeAll(async()=>{
    db=new PGlite();await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      CREATE TABLE public.business_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id));`);
    await db.exec(sql("2026-10-25-cash-forecast-storage"));await db.exec(sql("2026-10-26-repair-cash-forecast-publish-permissions"));
    await db.exec("CREATE UNIQUE INDEX cash_forecast_versions_one_draft_case ON public.cash_forecast_versions(forecast_id,case_type) WHERE status='draft'");
    await db.exec(sql("2026-10-27-retained-forecast-cases"));
  },60000);
  afterAll(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.exec(`BEGIN; INSERT INTO auth.users VALUES('${ids.owner}'),('${ids.other}');
      INSERT INTO public.business_profiles VALUES('${ids.business}','${ids.owner}');
      INSERT INTO public.cash_forecasts(id,user_id,business_id,reporting_currency) VALUES('${ids.forecast}','${ids.owner}','${ids.business}','USD');
      INSERT INTO public.cash_forecast_versions(id,forecast_id,user_id,version_number,as_of_date,start_date,starting_included_cash,minimum_reserve,formula_policy_version,created_by)
        VALUES('${ids.base}','${ids.forecast}','${ids.owner}',1,current_date,current_date,1000,400,'forecast-1','${ids.owner}');
      INSERT INTO public.cash_forecast_items(id,version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,source_updated_at,created_by,updated_by)
        VALUES('${ids.receipt}','${ids.base}','${ids.owner}','receipt','Customer receipt',1000,'inflow','customer_receipt',current_date+1,'confirmed','confirmed','manual',now(),'${ids.owner}','${ids.owner}'),
        ('${ids.bill}','${ids.base}','${ids.owner}','bill','Supplier payment',1500,'outflow','operating_vendor_payment',current_date+8,'confirmed','confirmed','manual',now(),'${ids.owner}','${ids.owner}');`);
    const dates=(await db.query<{today:string;receipt:string;bill:string}>("SELECT current_date::text AS today,(current_date+1)::text AS receipt,(current_date+8)::text AS bill")).rows[0];today=dates.today;
    base={id:ids.base,forecastId:ids.forecast,versionNumber:1,status:"published",startDate:today,asOfDate:today,startingCash:1000,minimumReserve:400,currency:"USD",formulaPolicyVersion:"forecast-1",
      items:[{id:ids.receipt,description:"Customer receipt",amount:1000,direction:"inflow",category:"customer_receipt",expectedDate:dates.receipt,status:"confirmed",confidence:"confirmed",sourceType:"manual",sourceUpdatedAt:today,amountIsEstimate:false,dateIsEstimate:false},
      {id:ids.bill,description:"Supplier payment",amount:1500,direction:"outflow",category:"operating_vendor_payment",expectedDate:dates.bill,status:"confirmed",confidence:"confirmed",sourceType:"manual",sourceUpdatedAt:today,amountIsEstimate:false,dateIsEstimate:false}]};
    const result=calculateForecastCase(base,[],today).baseResult;
    await db.query("UPDATE public.cash_forecast_versions SET status='published',published_by=$1,published_at=now(),calculation_result=$2 WHERE id=$3",[ids.owner,JSON.stringify(result),ids.base]);
  });
  afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE");});
  it("saves separate downside/upside versions with source lineage while preserving the published base",async()=>{
    await db.exec("SET LOCAL ROLE service_role");
    const down=await save();const up=await save([{id:randomUUID(),name:"Skip discretionary purchase",operation:"exclude",value:null,itemIds:[ids.bill],rationale:"Optional purchase can wait"}],randomUUID(),"upside");
    await db.exec("RESET ROLE");expect(down.version_number).toBe(2);expect(up.version_number).toBe(3);
    const v=(await db.query<{case_type:string;parent_version_id:string;status:string;calculation_result:{summary:{endingCash:number}}}>("SELECT * FROM public.cash_forecast_versions WHERE id=$1",[down.version_id])).rows[0];
    expect(v).toMatchObject({case_type:"downside",parent_version_id:ids.base,status:"published",calculation_result:{summary:{endingCash:300}}});
    expect((await db.query<{amount:number}>("SELECT amount::float AS amount FROM public.cash_forecast_items WHERE version_id=$1 AND evidence->>'case_base_item_id'=$2",[down.version_id,ids.receipt])).rows[0].amount).toBe(1000);
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_assumption_items WHERE version_id=$1",[down.version_id])).rows[0].n).toBe(2);
    expect((await db.query<{status:string;ending:number}>("SELECT status,(calculation_result->'summary'->>'endingCash')::float AS ending FROM public.cash_forecast_versions WHERE id=$1",[ids.base])).rows[0]).toEqual({status:"published",ending:500});
  });
  it("replays exactly once and retains superseded history, including after the source base changes",async()=>{
    const a=assumptions(),key=randomUUID(),first=await save(a,key);expect(await save(a,key)).toEqual({...first,replayed:true});
    const second=await save(a);expect(second.version_number).toBe(3);
    expect((await db.query<{status:string}>("SELECT status FROM public.cash_forecast_versions WHERE id=$1",[first.version_id])).rows[0].status).toBe("superseded");
    await db.query("UPDATE public.cash_forecast_versions SET status='superseded',superseded_at=now() WHERE id=$1",[ids.base]);
    await rejects(()=>save(a),/Base plan changed/);expect(await save(a,key)).toEqual({...first,replayed:true});
    await rejects(()=>db.query("UPDATE public.cash_forecast_versions SET case_name='changed' WHERE id=$1",[first.version_id]),/immutable/);
    await rejects(()=>db.query("UPDATE public.cash_forecast_items SET amount=1 WHERE version_id=$1",[second.version_id]),/Only draft/);
  });
  it("rejects changed idempotency payloads and cross-account bases",async()=>{
    const a=assumptions(),key=randomUUID();await save(a,key);const changed=structuredClone(a);changed[0].rationale="Different evidence";
    await rejects(()=>save(changed,key),/Request key reused/);await rejects(()=>save(a,randomUUID(),"downside",ids.other),/Base plan not found/);
  });
  it("rejects invalid references and conflicts at the SQL boundary",async()=>{
    const c=calculateForecastCase(base,assumptions(),today);
    const call=(a:unknown)=>db.query("SELECT public.save_cash_forecast_case($1,$2,'downside','Invalid probe',$3,$4,$5,$6,$7)",
      [ids.owner,ids.base,randomUUID(),JSON.stringify(a),JSON.stringify(c.caseResult),JSON.stringify(c.baseResult),today]);
    const foreign=assumptions();foreign[0].itemIds=[randomUUID()];await rejects(()=>call(foreign),/active source base/);
    const conflict=assumptions();conflict.push({...conflict[0],id:randomUUID()});await rejects(()=>call(conflict),/conflicting/);
    const excess=assumptions();excess[0].value=11;await rejects(()=>call(excess),/Invalid assumption/);
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_versions")).rows[0].n).toBe(1);
  });
  it("rolls back the new version, copied items and assumptions when publication fails late",async()=>{
    const a=assumptions(),result={...calculateForecastCase(base,a,today).caseResult,padding:"x".repeat(600000)};
    await rejects(()=>save(a,randomUUID(),"downside",ids.owner,result),/Invalid calculation result/);
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_versions")).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_items")).rows[0].n).toBe(2);
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_assumptions")).rows[0].n).toBe(0);
  });
  it("restricts execution to the service role and retains owner read isolation",async()=>{
    const saved=await save();await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.other]);await db.exec("SET LOCAL ROLE authenticated");
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_versions WHERE id=$1",[saved.version_id])).rows[0].n).toBe(0);
    await rejects(()=>save(),/permission denied/);await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[ids.owner]);await db.exec("SET LOCAL ROLE authenticated");
    expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cash_forecast_versions WHERE id=$1",[saved.version_id])).rows[0].n).toBe(1);
  });
  it("keeps Core revisions based on the base even after higher-numbered cases are published",async()=>{
    await save();await save(assumptions(),randomUUID(),"upside");
    const query="SELECT public.begin_core_forecast_revision($1,$2,current_date,current_date,1000,400) AS value";
    const first=(await db.query<{value:{version_id:string;version_number:number;reused:boolean}}>(query,[ids.owner,ids.base])).rows[0].value;
    expect(first.version_number).toBe(4);expect(first.reused).toBe(false);
    expect((await db.query<{value:{version_id:string;reused:boolean}}>(query,[ids.owner,ids.base])).rows[0].value).toMatchObject({version_id:first.version_id,reused:true});
    expect((await db.query<{case_type:string;parent_version_id:string}>("SELECT case_type,parent_version_id FROM public.cash_forecast_versions WHERE id=$1",[first.version_id])).rows[0]).toEqual({case_type:"base",parent_version_id:ids.base});
  });
  it("executes the identical rollback-only verifier prepared for preview",async()=>{
    await db.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)",[ids.owner,ids.other]);
    await db.exec(sql("verify-retained-forecast-cases"));
  });
});
