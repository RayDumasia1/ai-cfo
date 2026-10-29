import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { monthlyOwnershipSetup, ownershipMigration, v2Month } from "./fixtures/monthlyOwnershipDb";
import { orgOwner, orgOther, orgProfile, orgOtherProfile } from "./fixtures/organizationDb";
let db: PGlite, own: string, other: string, before: unknown[], oldReview: string;
const tables = ["financial_months", "expense_categories", "data_imports", "financial_data_revisions"];
async function snapshot() {
  return Promise.all(tables.map(async t => (await db.query(`SELECT to_jsonb(t)-'organization_id' AS row FROM public.${t} t ORDER BY id`)).rows));
}
async function value<T = unknown>(sql: string, args: unknown[] = []) { return (await db.query<{ value: T }>(sql, args)).rows[0].value; }
async function state() { return value<string>("SELECT public.financial_import_review_state($1)->>'state_version' AS value", [orgOwner]); }
async function denied(sql: string, args: unknown[] = [], code = "23514") {
  await db.exec("SAVEPOINT reject_scope");
  try { await expect(db.query(sql, args)).rejects.toMatchObject({ code }); }
  finally { await db.exec("ROLLBACK TO SAVEPOINT reject_scope; RELEASE SAVEPOINT reject_scope"); }
}
describe("ORG-01D2 monthly/import organization storage", () => {
  beforeAll(async () => {
    db = new PGlite(); await monthlyOwnershipSetup(db); before = await snapshot(); oldReview = await state();
    await db.exec(ownershipMigration());
    own = await value<string>("SELECT organization_id AS value FROM public.legacy_account_organizations WHERE legacy_user_id=$1", [orgOwner]);
    other = await value<string>("SELECT organization_id AS value FROM public.legacy_account_organizations WHERE legacy_user_id=$1", [orgOther]);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("BEGIN"); });
  afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE"); });
  it("backfills only new ownership; preserves timestamps, amounts, nulls and archived JSON", async () => {
    expect(await snapshot()).toEqual(before);
    for (const t of tables) expect(await value<number>(`SELECT count(*)::int AS value FROM public.${t} WHERE organization_id IS NULL OR organization_id<>$1`, [own])).toBe(0);
    expect(await state()).not.toBe(oldReview);
    expect(await value("SELECT data_version AS value FROM public.business_profiles WHERE id=$1", [orgProfile])).toBe("keep-version");
  });
  it("stamps service inserts and rejects explicit foreign/missing profile scope", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    expect(await value("INSERT INTO public.financial_months(user_id,business_id,month_date,closing_cash) VALUES($1,$2,'2026-10-01',0) RETURNING organization_id AS value", [orgOwner, orgProfile])).toBe(own);
    await denied("INSERT INTO public.financial_months(user_id,business_id,month_date,organization_id) VALUES($1,$2,'2026-11-01',$3)", [orgOwner, orgProfile, other]);
    await denied("INSERT INTO public.expense_categories(user_id,business_id,month_date,category,amount) VALUES($1,$2,'2026-11-01','Payroll',0)", [orgOwner, orgOtherProfile]);
    await denied("INSERT INTO public.financial_months(user_id,month_date) VALUES($1,'2026-11-01')", [orgOwner]);
  });
  it("prevents organization, account or live profile reassignment", async () => {
    await denied("UPDATE public.financial_months SET organization_id=$1 WHERE user_id=$2", [other, orgOwner]);
    await denied("UPDATE public.financial_months SET organization_id=NULL WHERE user_id=$1", [orgOwner]);
    await denied("UPDATE public.financial_months SET user_id=$1 WHERE user_id=$2", [orgOther, orgOwner]);
    await denied("UPDATE public.financial_months SET business_id=NULL WHERE user_id=$1", [orgOwner]);
    await denied("UPDATE public.financial_months SET business_id=$1 WHERE user_id=$2", [orgOtherProfile, orgOwner]);
  });
  it("keeps browser audit INSERT owner-scoped without private metadata privileges", async () => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [orgOwner]); await db.exec("SET LOCAL ROLE authenticated");
    expect(await value("INSERT INTO public.data_imports(user_id,import_type,status) VALUES($1,'manual','error') RETURNING organization_id AS value", [orgOwner])).toBe(own);
    await denied("INSERT INTO public.data_imports(user_id,import_type,status,organization_id) VALUES($1,'manual','error',$2)", [orgOwner, other]);
    await denied("INSERT INTO public.data_imports(user_id,import_type,status) VALUES($1,'manual','error')", [orgOther], "42501");
    await denied("SELECT * FROM organization_private.financial_scopes", [], "42501");
    await denied("SELECT organization_private.guard_monthly_ownership()", [], "42501");
  });
  it("retains C owner read parity and foreign selection denial", async () => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [orgOwner]); await db.exec("SET LOCAL ROLE authenticated");
    const result = await value<{ months: Array<{ organization_id: string; closing_cash: number | null }> }>("SELECT public.read_owned_financial_months($1,NULL) AS value", [own]);
    expect(result.months.map(m => [m.organization_id,m.closing_cash])).toEqual([[own,null],[own,0]]);
    expect(await value("SELECT count(*)::int AS value FROM public.financial_months")).toBe(2);
    await denied("SELECT public.read_owned_financial_months($1,NULL)", [other], "P0002");
  });
  it("supports authenticated profile INSERT RETURNING and atomic B+D2 provisioning", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]); await db.exec("SET LOCAL ROLE authenticated");
    const id = await value("INSERT INTO public.business_profiles(user_id) VALUES($1) RETURNING id AS value", [user]);
    expect(id).toBeTruthy(); await db.exec("RESET ROLE");
    expect(await value("SELECT count(*)::int AS value FROM organization_private.financial_scopes WHERE legacy_user_id=$1", [user])).toBe(1);
  });
  it("does not create a profile merely to record an unscoped failed-import audit", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    await denied("INSERT INTO public.data_imports(user_id,import_type,status) VALUES($1,'csv','error')", [user], "55000");
    expect(await value("SELECT count(*)::int AS value FROM public.business_profiles WHERE user_id=$1", [user])).toBe(0);
  });
  it("preserves profile deletion SET NULL, immutable scope identity and archived snapshots", async () => {
    await db.query("DELETE FROM public.business_profiles WHERE id=$1", [orgProfile]);
    expect(await value("SELECT count(*)::int AS value FROM public.financial_months WHERE user_id=$1 AND business_id IS NULL AND organization_id=$2", [orgOwner, own])).toBe(2);
    expect(await value("SELECT lifecycle AS value FROM public.organizations WHERE id=$1", [own])).toBe("archived");
    expect(await value("SELECT count(*)::int AS value FROM organization_private.financial_scopes WHERE organization_id=$1", [own])).toBe(1);
    expect((await db.query("SELECT to_jsonb(t)-'organization_id' AS row FROM public.financial_data_revisions t ORDER BY id")).rows).toEqual(before[3]);
    await denied("UPDATE organization_private.financial_scopes SET legacy_user_id=$1 WHERE organization_id=$2", [orgOther, own], "55000");
  });
  it("keeps Auth deletion cascades and B tombstones compatible", async () => {
    await db.query("DELETE FROM auth.users WHERE id=$1", [orgOwner]);
    for (const t of tables) expect(await value(`SELECT count(*)::int AS value FROM public.${t} WHERE user_id=$1`, [orgOwner])).toBe(0);
    expect(await value("SELECT lifecycle AS value FROM public.organizations WHERE id=$1", [own])).toBe("archived");
  });
  it("invalidates an old review once; new v2 imports, no-op comparison and snapshots work", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    const call = "SELECT public.import_reviewed_financial_data($1,$2::jsonb,'{}','new.xlsx','replace_all',$3) AS value";
    await denied(call, [orgOwner, JSON.stringify([v2Month]), oldReview], "P0001");
    const token = await state(); await value(call, [orgOwner, JSON.stringify([v2Month]), token]);
    expect(await value("SELECT organization_id AS value FROM public.financial_months WHERE user_id=$1", [orgOwner])).toBe(own);
    const saved = await snapshot(); const token2 = await state();
    const result = await value<{ unchanged: boolean }>(call, [orgOwner, JSON.stringify([v2Month]), token2]);
    expect(result.unchanged).toBe(true); expect(await snapshot()).toEqual(saved); expect(await state()).toBe(token2);
    const row = await value<Array<{ organization_id: string }>>("SELECT months_snapshot AS value FROM public.financial_data_revisions WHERE user_id=$1 ORDER BY id DESC LIMIT 1", [orgOwner]);
    expect(row.every(m => m.organization_id === own)).toBe(true);
  });
  it("supports legacy import aliases, update-months and Clear Data while retaining profile settings", async () => {
    await db.exec("SET LOCAL ROLE service_role");
    await value("SELECT public.replace_financial_import($1,$2::jsonb,'{}','legacy.csv') AS value", [orgOwner, JSON.stringify([{month_date:"2026-10-01",opening_cash:0,closing_cash:0,total_revenue:0,total_expenses:0}])]);
    await value("SELECT public.import_financial_data($1,$2::jsonb,'{}','update.csv','update_months') AS value", [orgOwner, JSON.stringify([{month_date:"2026-11-01",closing_cash:20}])]);
    expect(await value("SELECT count(*)::int AS value FROM public.financial_months WHERE user_id=$1 AND organization_id=$2", [orgOwner,own])).toBe(2);
    await value("SELECT public.clear_financial_data($1) AS value", [orgOwner]);
    expect(await value("SELECT min_cash_reserve::int AS value FROM public.business_profiles WHERE user_id=$1", [orgOwner])).toBe(0);
    expect(await value("SELECT count(*)::int AS value FROM public.financial_months WHERE user_id=$1", [orgOwner])).toBe(0);
    expect(await value("SELECT count(*)::int AS value FROM public.financial_data_revisions WHERE user_id=$1", [orgOwner])).toBe(0);
    expect(await value("SELECT organization_id AS value FROM public.data_imports WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [orgOwner])).toBe(own);
  });
  it("rejects newly fabricated foreign snapshot ownership", async () => {
    await denied("INSERT INTO public.financial_data_revisions(user_id,replaced_by_filename,profile_snapshot,months_snapshot,categories_snapshot) VALUES($1,'bad.csv','{}',$2::jsonb,'[]')", [orgOwner,JSON.stringify([{organization_id:other,user_id:orgOwner}])]);
  });
  it("keeps import failures atomic through revision capture, row replacement and audit", async () => {
    await db.exec(`CREATE FUNCTION public.fail_d2_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late audit failure'; END $$;
      CREATE TRIGGER fail_d2_audit BEFORE INSERT ON public.data_imports FOR EACH ROW EXECUTE FUNCTION public.fail_d2_audit();`);
    const saved = await snapshot(); const token = await state();
    await denied("SELECT public.import_financial_data_v2($1,$2::jsonb,'{}','fail.xlsx','replace_all')", [orgOwner,JSON.stringify([v2Month])], "P0001");
    expect(await snapshot()).toEqual(saved); expect(await state()).toBe(token);
  });
  it("provisions B and immutable D2 scope for a real first import without a prior profile", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]); await db.exec("SET LOCAL ROLE service_role");
    await value("SELECT public.import_financial_data_v2($1,$2::jsonb,'{}','first.xlsx','replace_all') AS value", [user,JSON.stringify([v2Month])]);
    await db.exec("RESET ROLE");
    const rows = (await db.query("SELECT m.organization_id=s.organization_id AND m.business_id=s.legacy_business_profile_id AS consistent FROM public.financial_months m JOIN organization_private.financial_scopes s ON s.legacy_user_id=m.user_id WHERE m.user_id=$1", [user])).rows;
    expect(rows).toEqual([{consistent:true}]);
  });
  it("uses actual composite FKs independently of the stamping guard", async () => {
    await db.exec("ALTER TABLE public.financial_months DISABLE TRIGGER organization_monthly_ownership");
    await denied("INSERT INTO public.financial_months(user_id,business_id,month_date,organization_id) VALUES($1,$2,'2026-11-01',$3)", [orgOwner,orgOtherProfile,own], "23503");
    await denied("INSERT INTO public.financial_months(user_id,business_id,month_date,organization_id) VALUES($1,$2,'2026-11-01',$3)", [orgOwner,orgProfile,other], "23503");
  });
  it("keeps scope storage and helpers inaccessible to all application roles", async () => {
    for (const role of ["anon","authenticated","service_role"]) {
      expect(await value("SELECT has_schema_privilege($1,'organization_private','USAGE') AS value", [role])).toBe(false);
      expect(await value("SELECT has_table_privilege($1,'organization_private.financial_scopes','SELECT,INSERT,UPDATE,DELETE') AS value", [role])).toBe(false);
      expect(await value("SELECT has_function_privilege($1,'organization_private.guard_monthly_ownership()','EXECUTE') AS value", [role])).toBe(false);
    }
  });
});
describe("D2 migration preflight and rollback", () => {
  it("aborts on inconsistent categories and leaves no partial expansion", async () => {
    const engine = new PGlite();
    try {
      await monthlyOwnershipSetup(engine);
      await engine.query("UPDATE public.expense_categories SET business_id=$1 WHERE user_id=$2", [orgOtherProfile,orgOwner]);
      await expect(engine.exec(ownershipMigration())).rejects.toThrow(/scope requires reviewed repair/);
      await engine.exec("ROLLBACK");
      expect((await engine.query("SELECT to_regclass('organization_private.financial_scopes') AS scope")).rows).toEqual([{scope:null}]);
      expect((await engine.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='financial_months' AND column_name='organization_id'")).rows).toEqual([{n:0}]);
    } finally { await engine.close(); }
  }, 60000);
});
