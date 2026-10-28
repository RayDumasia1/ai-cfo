import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgBootstrap, orgMigration, orgOwner, orgOther, orgProfile, orgOtherProfile } from "./fixtures/organizationDb";
import { validateOwnerMonthlyRead } from "../lib/organizationAccess";
const migration = () => readFileSync(new URL("../docs/migrations/2026-10-28-organization-owner-monthly-reads.sql", import.meta.url), "utf8");
let db: PGlite, selected: string, foreign: string;
type MonthlyResult = { state: string; months: Array<{ id: string; user_id: string; business_id: string; closing_cash: number | null }>; context: { actorId: string; organizationId: string; businessName: string | null; dataVersion: string | null; entitlementTier: string } | null };
async function read(org: string | null = null, limit: number | null = null) {
  return (await db.query<{ value: MonthlyResult }>("SELECT public.read_owned_financial_months($1::uuid,$2::integer) AS value", [org, limit])).rows[0].value;
}
async function authenticate(user = orgOwner) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]); await db.exec("SET LOCAL ROLE authenticated"); }
async function reject(run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("SAVEPOINT denied"); try { await expect(run()).rejects.toThrow(pattern); } finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied"); }
}
async function setup(engine: PGlite) {
  await engine.exec(orgBootstrap);
  await engine.exec(`ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
    CREATE TABLE public.subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE REFERENCES auth.users(id),plan text,feature_tier text,status text,stripe_subscription_id text);
    INSERT INTO public.subscriptions(user_id,plan,feature_tier,status,stripe_subscription_id) VALUES
      ('${orgOwner}','core','core','active',NULL),('${orgOther}','advisory','advisory','active',NULL);
    CREATE TABLE public.financial_months(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),business_id uuid REFERENCES public.business_profiles(id),
      month_date date NOT NULL,closing_cash numeric,notes text,UNIQUE(user_id,month_date));
    ALTER TABLE public.financial_months ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "financial_months: own rows" ON public.financial_months TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    GRANT SELECT ON public.financial_months TO authenticated;
    INSERT INTO public.financial_months(user_id,business_id,month_date,closing_cash,notes) VALUES
      ('${orgOwner}','${orgProfile}','2026-09-01',0,'explicit zero'),('${orgOwner}','${orgProfile}','2026-08-01',NULL,'unknown'),
      ('${orgOther}','${orgOtherProfile}','2026-09-01',999,'other business');`);
  await engine.exec(orgMigration());
  await engine.query("SELECT public.ensure_legacy_organization($1,$2,$3)", [orgProfile, orgOwner, randomUUID()]);
  await engine.query("SELECT public.ensure_legacy_organization($1,$2,$3)", [orgOtherProfile, orgOther, randomUUID()]);
}
describe("ORG-01C original-owner monthly read boundary", () => {
  beforeAll(async () => {
    db = new PGlite(); await setup(db); await db.exec(migration());
    selected = (await db.query<{ organization_id: string }>("SELECT organization_id FROM public.legacy_account_organizations WHERE legacy_user_id=$1", [orgOwner])).rows[0].organization_id;
    foreign = (await db.query<{ organization_id: string }>("SELECT organization_id FROM public.legacy_account_organizations WHERE legacy_user_id=$1", [orgOther])).rows[0].organization_id;
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("BEGIN"); });
  afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE"); });
  it("preserves raw rows, order, null/zero and current profile name, without writes", async () => {
    await db.query("UPDATE public.business_profiles SET business_name='Current name' WHERE id=$1", [orgProfile]);
    const before = (await db.query<{ value: unknown }>("SELECT to_jsonb(f) AS value FROM public.financial_months f WHERE user_id=$1 ORDER BY month_date DESC", [orgOwner])).rows.map(r => r.value);
    await authenticate(); const result = await read(); expect(result.state).toBe("ready"); expect(result.months).toEqual(before);
    expect(validateOwnerMonthlyRead(result,orgOwner,selected,null).months).toEqual(before);
    expect(result.context).toMatchObject({ actorId: orgOwner, organizationId: selected, businessName: "Current name", dataVersion: "keep-version", entitlementTier: "core" });
    expect(await read(selected)).toEqual(result); expect((await read(selected, 1)).months).toHaveLength(1);
    expect((await db.query("SELECT id FROM public.financial_months")).rows).toHaveLength(2);
  });
  it("exposes only the caller's safe workspace descriptor and rejects foreign selectors", async () => {
    await authenticate(); const list = (await db.query<{ value: unknown }>("SELECT public.list_owned_organizations() AS value")).rows[0].value;
    expect(list).toEqual([{ id: selected, businessName: "Existing business" }]);
    await reject(() => read(foreign), /Workspace unavailable/); await reject(() => read(randomUUID()), /Workspace unavailable/);
    expect((await db.query("SELECT * FROM public.financial_months WHERE user_id=$1", [orgOther])).rows).toHaveLength(0);
  });
  it("does not let a higher-tier owner read a different customer's data", async () => {
    await authenticate(orgOther); await reject(() => read(selected), /Workspace unavailable/);
    expect((await read()).months.map(m => m.user_id)).toEqual([orgOther]);
  });
  it("requires verified Auth for RPCs and direct monthly SELECT", async () => {
    await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [orgOwner]); await authenticate();
    await reject(() => read(), /Verified owner required/);
    await reject(() => db.query("SELECT public.list_owned_organizations()"), /Verified owner required/);
    expect((await db.query("SELECT id FROM public.financial_months")).rows).toHaveLength(0);
  });
  it.each(["anon", "service_role"])("does not grant %s execution of owner RPCs", async role => {
    await db.exec(`SET LOCAL ROLE ${role}`); await reject(() => read(), /permission denied/);
    await reject(() => db.query("SELECT public.list_owned_organizations()"), /permission denied/);
  });
  it.each(["cancelled", "suspended"])("denies monthly reads after %s while preserving owner discovery", async status => {
    await db.query("UPDATE public.subscriptions SET status=$1 WHERE user_id=$2", [status, orgOwner]); await authenticate();
    expect(await read()).toEqual({ state: "subscription_required", context: null, months: [] });
    expect((await db.query("SELECT * FROM public.financial_months")).rows).toHaveLength(0);
    expect((await db.query<{ value: unknown[] }>("SELECT public.list_owned_organizations() AS value")).rows[0].value).toHaveLength(1);
  });
  it("uses the target legacy subscription for pending cancellation and paid Starter", async () => {
    await db.query("UPDATE public.subscriptions SET status='pending_cancellation',plan='starter',feature_tier='starter',stripe_subscription_id='sub_test' WHERE user_id=$1", [orgOwner]);
    await authenticate(); expect((await read()).context?.entitlementTier).toBe("starter");
    await db.exec("RESET ROLE"); await db.query("UPDATE public.subscriptions SET stripe_subscription_id=NULL WHERE user_id=$1", [orgOwner]);
    await authenticate(); expect((await read()).state).toBe("subscription_required");
  });
  it("distinguishes truly absent profiles without provisioning during reads", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]); await authenticate(user);
    expect(await read()).toEqual({ state: "profile_missing", context: null, months: [] });
    expect((await db.query<{ value: unknown[] }>("SELECT public.list_owned_organizations() AS value")).rows[0].value).toEqual([]);
    await reject(() => read(selected), /Workspace unavailable/);
    await db.exec("RESET ROLE"); expect((await db.query("SELECT id FROM public.business_profiles WHERE user_id=$1", [user])).rows).toHaveLength(0);
  });
  it("preserves authenticated profile INSERT RETURNING before the B hook completes", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]); await authenticate(user);
    expect((await db.query("INSERT INTO public.business_profiles(user_id) VALUES($1) RETURNING id", [user])).rows).toHaveLength(1);
    expect((await read()).state).toBe("subscription_required");
  });
  it("fails closed for a missing graph and malformed service-written month scope", async () => {
    // Simulate an emergency provisioning-hook gap without altering any real account.
    const user = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    await db.exec("ALTER TABLE public.business_profiles DISABLE TRIGGER organization_profile_provisioned");
    await db.query("INSERT INTO public.business_profiles(user_id) VALUES($1)", [user]); await db.exec("ALTER TABLE public.business_profiles ENABLE TRIGGER organization_profile_provisioned");
    await authenticate(user); await reject(() => read(), /identity unavailable/);
    await db.exec("RESET ROLE"); await db.query("INSERT INTO public.financial_months(user_id,business_id,month_date) VALUES($1,$2,'2026-10-01')", [orgOwner, orgOtherProfile]);
    await authenticate(); await reject(() => read(), /ownership evidence unavailable/);
    expect((await db.query("SELECT id FROM public.financial_months WHERE month_date='2026-10-01'")).rows).toHaveLength(0);
  });
  it("refuses unsupported limits and all-history overflow without silent truncation", async () => {
    await authenticate(); for (const limit of [0, 241]) await reject(() => read(null, limit), /Unsupported monthly read limit/);
    await db.exec("RESET ROLE"); await db.query(`INSERT INTO public.financial_months(user_id,business_id,month_date)
      SELECT $1,$2,(date '2000-01-01'+i*interval '1 month')::date FROM generate_series(0,239) i`, [orgOwner, orgProfile]);
    await authenticate(); await reject(() => read(), /exceeds supported read size/); expect((await read(null, 12)).months).toHaveLength(12);
  });
  it("requires complete, clean B/month scope before replacing the legacy policy", async () => {
    const alternate = new PGlite();
    try {
      await setup(alternate); await alternate.query("UPDATE public.financial_months SET business_id=NULL WHERE user_id=$1", [orgOwner]);
      await expect(alternate.exec(migration())).rejects.toThrow(/Monthly ownership scope requires reviewed repair/); await alternate.exec("ROLLBACK");
      expect((await alternate.query("SELECT policyname FROM pg_policies WHERE tablename='financial_months'")).rows).toEqual([{ policyname: "financial_months: own rows" }]);
    } finally { await alternate.close(); }
  }, 60000);
});
