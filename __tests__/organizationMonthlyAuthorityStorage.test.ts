import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { monthlyOwnershipSetup, ownershipMigration, v2Month } from "./fixtures/monthlyOwnershipDb";
import { orgOwner, orgOther, orgProfile } from "./fixtures/organizationDb";
const migration=()=>readFileSync(new URL("../docs/migrations/2026-10-29-organization-monthly-write-authority.sql",import.meta.url),"utf8");
let db:PGlite,own:string,foreign:string;
async function value<T=unknown>(sql:string,args:unknown[]=[]){return (await db.query<{value:T}>(sql,args)).rows[0].value;}
async function denied(sql:string,args:unknown[]=[],code="42501"){
  await db.exec("SAVEPOINT denied");try{await expect(db.query(sql,args)).rejects.toMatchObject({code});}finally{await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied");}
}
async function auth(user=orgOwner){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);await db.exec("SET LOCAL ROLE authenticated");}
async function operation<T=unknown>(op:string,org:string|null=null,months:unknown[]=[v2Month],state:string|null=null){
  return value<T>("SELECT public.owned_monthly_operation($1,$2,$3::jsonb,'{}','replace_all','new.xlsx',$4) AS value",[op,org,JSON.stringify(months),state]);
}
type Review={context:{actorId:string;organizationId:string;accessRevision:number};reviewState:{state_version:string;months:string[]};unchanged:boolean};
describe("ORG-01D3 authenticated original-owner monthly authority",()=>{
  beforeAll(async()=>{db=new PGlite();await monthlyOwnershipSetup(db);await db.exec(ownershipMigration());await db.exec(migration());
    own=await value<string>("SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1",[orgOwner]);
    foreign=await value<string>("SELECT organization_id AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1",[orgOther]);
  },60000);
  afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec("BEGIN");});afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE");});
  it("authorizes the current target and rejects a paid foreign organization",async()=>{
    await auth();expect(await operation("authorize",own)).toMatchObject({authorized:true,actorId:orgOwner,organizationId:own});
    await denied("SELECT public.owned_monthly_operation('review',$1,$2::jsonb)",[foreign,JSON.stringify([v2Month])],"P0002");
  });
  it("uses authenticated authority for review/confirm/no-op without service DML",async()=>{
    await auth();const review=await operation<Review>("review",own);
    expect(review.context).toMatchObject({actorId:orgOwner,organizationId:own});
    expect(await operation("confirm",own,[v2Month],review.reviewState.state_version)).toMatchObject({unchanged:false,months_imported:1});
    const next=await operation<Review>("review",own);expect(next.unchanged).toBe(true);
    await operation("confirm",own,[v2Month],next.reviewState.state_version);await db.exec("RESET ROLE");
    expect(await value("SELECT count(*)::int AS value FROM organization_private.monthly_write_events WHERE operation='import'")).toBe(1);
  });
  it("rejects stale state even for a semantic no-op",async()=>{
    await auth();await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','new.xlsx',$3)",[own,JSON.stringify([v2Month]),"a".repeat(32)],"P0001");
  });
  it("rejects unverified, lapsed and suspended authority at the database boundary",async()=>{
    await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1",[orgOwner]);await auth();
    await denied("SELECT public.owned_monthly_operation('authorize')");await db.exec("RESET ROLE");
    await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[orgOwner]);
    for(const [status,tier] of [["cancelled","core"],["active","suspended"]]){
      await db.query("UPDATE public.subscriptions SET status=$1,feature_tier=$2 WHERE user_id=$3",[status,tier,orgOwner]);await auth();
      await denied("SELECT public.owned_monthly_operation('review',NULL,$1::jsonb)",[JSON.stringify([v2Month])],"P0402");await db.exec("RESET ROLE");
    }
  });
  it("binds review state to current target entitlement",async()=>{
    await auth();const first=await operation<Review>("review",own);await db.exec("RESET ROLE");
    await db.query("UPDATE public.subscriptions SET feature_tier='growth' WHERE user_id=$1",[orgOwner]);await auth();
    const second=await operation<Review>("review",own);expect(second.reviewState.state_version).not.toBe(first.reviewState.state_version);
    await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','new.xlsx',$3)",[own,JSON.stringify([v2Month]),first.reviewState.state_version],"P0001");
  });
  it("invalidates a prepared review after verification is revoked and restored",async()=>{
    await auth();const first=await operation<Review>("review",own);await db.exec("RESET ROLE");
    await db.query("UPDATE auth.users SET email_confirmed_at=email_confirmed_at+interval '1 microsecond' WHERE id=$1",[orgOwner]);await auth();
    await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','new.xlsx',$3)",[own,JSON.stringify([v2Month]),first.reviewState.state_version],"P0001");
  });
  it("preserves narrow onboarding and alert preference writers after profile UPDATE closure",async()=>{
    await auth();
    expect(await value("SELECT public.update_owned_profile_preferences('7d',true)->>'success' AS value")).toBe("true");
    await db.exec("RESET ROLE");const timestamp=await value("SELECT onboarding_completed_at::text AS value FROM public.business_profiles WHERE user_id=$1",[orgOwner]);
    await auth();await value("SELECT public.update_owned_profile_preferences('data_reload',true) AS value");
    await denied("SELECT public.update_owned_profile_preferences('forever')",[],"22023");await db.exec("RESET ROLE");
    expect(await value("SELECT onboarding_completed_at::text AS value FROM public.business_profiles WHERE user_id=$1",[orgOwner])).toBe(timestamp);
    expect(await value("SELECT snooze_duration AS value FROM public.business_profiles WHERE user_id=$1",[orgOwner])).toBe("data_reload");
  });
  it("rejects anonymous operations and malformed payloads",async()=>{
    await db.exec("SET LOCAL ROLE anon");await denied("SELECT public.owned_monthly_operation('clear')");await db.exec("RESET ROLE");await auth();
    await denied("SELECT public.owned_monthly_operation('review',NULL,'[]')",[],"22023");
    await denied("SELECT public.owned_monthly_operation('review',NULL,'{}')",[],"22023");
    await denied("SELECT public.owned_monthly_operation('arbitrary')",[],"22023");
  });
  it("closes all legacy engine and direct service write paths",async()=>{
    await db.exec("SET LOCAL ROLE service_role");
    await denied("SELECT public.import_financial_data_v2($1,$2::jsonb,'{}','bad.xlsx','replace_all')",[orgOwner,JSON.stringify([v2Month])]);
    await denied("SELECT public.clear_financial_data($1)",[orgOwner]);
    await denied("SELECT public.financial_import_review_state($1)",[orgOwner]);
    await denied("SELECT public.owned_monthly_operation('clear')");
    await denied("UPDATE public.financial_months SET closing_cash=42 WHERE user_id=$1",[orgOwner]);
    await denied("DELETE FROM public.financial_data_revisions WHERE user_id=$1",[orgOwner]);
    await denied("UPDATE public.business_profiles SET min_cash_reserve=999 WHERE user_id=$1",[orgOwner]);
    await db.query("SELECT id FROM public.business_profiles WHERE user_id=$1 FOR UPDATE",[orgOwner]);
  });
  it("closes browser audit INSERT and profile UPDATE but preserves verified bootstrap",async()=>{
    await auth();await denied("INSERT INTO public.data_imports(user_id,import_type,status) VALUES($1,'manual','error')",[orgOwner]);
    await denied("UPDATE public.business_profiles SET business_name='bypass' WHERE user_id=$1",[orgOwner]);
    expect(await value("SELECT public.ensure_owned_business_profile()->>'user_id' AS value")).toBe(orgOwner);
    expect(await operation("audit_failure",own)).toMatchObject({user_id:orgOwner,organization_id:own,status:"error"});
  });
  it("updates only allowlisted owner settings and preserves foreign isolation",async()=>{
    await auth();const patch={business_name:"Verified business",min_cash_reserve:0,runway_warning_threshold:6,runway_danger_threshold:3,burn_rate_warning_pct:.1};
    expect(await value("SELECT public.update_owned_business_profile($1::jsonb,$2) AS value",[JSON.stringify(patch),own])).toMatchObject({...patch,user_id:orgOwner});
    await denied("SELECT public.update_owned_business_profile('{\"data_version\":\"fake\"}')",[],"22023");
    await denied("SELECT public.update_owned_business_profile('{\"business_name\":\"fake\"}',$1)",[foreign],"P0002");
  });
  it("allows verified owner metadata maintenance after lapse without financial access",async()=>{
    await db.query("UPDATE public.subscriptions SET status='cancelled' WHERE user_id=$1",[orgOwner]);await auth();
    expect(await value("SELECT public.update_owned_business_profile('{\"business_name\":\"After lapse\"}')->>'business_name' AS value")).toBe("After lapse");
    await denied("SELECT public.owned_monthly_operation('clear')",[],"P0402");
  });
  it("preflights a missing profile without setup writes, then provisions a valid first review",async()=>{
    const fresh=randomUUID();await db.query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())",[fresh]);
    await db.query("INSERT INTO public.subscriptions(user_id,plan,feature_tier,status) VALUES($1,'core','core','active')",[fresh]);await auth(fresh);
    expect(await operation("authorize")).toMatchObject({authorized:true,organizationId:null});await db.exec("RESET ROLE");
    expect(await value("SELECT count(*)::int AS value FROM public.business_profiles WHERE user_id=$1",[fresh])).toBe(0);await auth(fresh);
    const review=await operation<Review>("review");expect(review.context.actorId).toBe(fresh);
    await operation("confirm",review.context.organizationId,[v2Month],review.reviewState.state_version);
  });
  it("keeps explicit foreign missing-profile selection from provisioning a workspace",async()=>{
    const fresh=randomUUID();await db.query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())",[fresh]);await auth(fresh);
    await denied("SELECT public.owned_monthly_operation('review',$1,$2::jsonb)",[own,JSON.stringify([v2Month])],"P0002");await db.exec("RESET ROLE");
    expect(await value("SELECT count(*)::int AS value FROM public.business_profiles WHERE user_id=$1",[fresh])).toBe(0);
  });
  it("clears atomically with attributable history and retains settings",async()=>{
    await auth();expect(await operation("clear",own)).toMatchObject({cleared:true});await db.exec("RESET ROLE");
    expect(await value("SELECT count(*)::int AS value FROM public.financial_months WHERE user_id=$1",[orgOwner])).toBe(0);
    expect(await value("SELECT min_cash_reserve::int AS value FROM public.business_profiles WHERE id=$1",[orgProfile])).toBe(0);
    expect(await value("SELECT actor_reference AS value FROM organization_private.monthly_write_events WHERE operation='clear'")).toBe(orgOwner);
    await denied("UPDATE organization_private.monthly_write_events SET operation='import'",[],"55000");
  });
  it("keeps attributed import failure atomic",async()=>{
    await db.exec(`CREATE FUNCTION public.fail_monthly_attribution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event failure'; END $$;
      CREATE TRIGGER fail_monthly_attribution BEFORE INSERT ON organization_private.monthly_write_events FOR EACH ROW EXECUTE FUNCTION public.fail_monthly_attribution();`);
    await auth();const review=await operation<Review>("review",own);
    await denied("SELECT public.owned_monthly_operation('confirm',$1,$2::jsonb,'{}','replace_all','new.xlsx',$3)",[own,JSON.stringify([v2Month]),review.reviewState.state_version],"P0001");
    expect((await operation<Review>("review",own)).reviewState.state_version).toBe(review.reviewState.state_version);
  });
  it("preserves profile/Auth deletion and immutable audit attribution",async()=>{
    await auth();await value("SELECT public.update_owned_business_profile('{\"business_name\":\"Audit\"}') AS value");await db.exec("RESET ROLE");
    await db.query("DELETE FROM auth.users WHERE id=$1",[orgOwner]);
    expect(await value("SELECT lifecycle AS value FROM public.organizations WHERE id=$1",[own])).toBe("archived");
    expect(await value("SELECT actor_reference AS value FROM organization_private.monthly_write_events LIMIT 1")).toBe(orgOwner);
  });
});
