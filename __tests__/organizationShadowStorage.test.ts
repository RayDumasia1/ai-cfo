import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgBootstrap, orgMigration, orgOther, orgOwner, orgProfile } from "./fixtures/organizationDb";
let db: PGlite;
type Result = { organization_id: string; membership_id: string; business_profile_id: string; provisioning_operation_id: string; created: boolean };
async function ensure(profile = orgProfile, user = orgOwner, operation = randomUUID()) {
  return (await db.query<{ result: Result }>("SELECT public.ensure_legacy_organization($1,$2,$3) AS result", [profile, user, operation])).rows[0].result;
}
async function snapshot() {
  return (await db.query<{ value: object }>(`SELECT jsonb_build_object(
    'organizations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.organizations o),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM public.organization_memberships m),
    'mappings',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY legacy_business_profile_id),'[]') FROM public.legacy_account_organizations l),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.organization_access_events e)) AS value`)).rows[0].value;
}
async function reject(operation: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("SAVEPOINT negative_probe");
  try { await expect(operation()).rejects.toThrow(pattern); }
  finally { await db.exec("ROLLBACK TO SAVEPOINT negative_probe; RELEASE SAVEPOINT negative_probe"); }
}
async function validate() { await db.exec("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED"); }
async function newProfile() {
  const user = randomUUID(), id = randomUUID();
  await db.query("INSERT INTO auth.users VALUES($1)", [user]);
  await db.query("INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2)", [id, user]);
  return { id, user };
}
describe("ORG-01B internal organization database", () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(orgBootstrap); await db.exec(orgMigration()); }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("BEGIN"); });
  afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE"); });
  it("backfills independent identity without modifying the old profile and replays byte-for-byte", async () => {
    const before = (await db.query("SELECT * FROM public.business_profiles WHERE id=$1", [orgProfile])).rows;
    await db.exec("SET LOCAL ROLE service_role"); const first = await ensure();
    expect(first.created).toBe(true); expect(first.organization_id).not.toBe(orgProfile); expect(first.organization_id).not.toBe(orgOwner);
    await db.exec("RESET ROLE"); const shadow = await snapshot();
    expect(await ensure()).toEqual({ ...first, created: false }); expect(await snapshot()).toEqual(shadow);
    expect((await db.query("SELECT * FROM public.business_profiles WHERE id=$1", [orgProfile])).rows).toEqual(before); await validate();
  });
  it("atomically provisions authenticated own-profile inserts with metadata privileges revoked", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]); await db.exec("SET LOCAL ROLE authenticated");
    const profile = (await db.query<{ id: string }>("INSERT INTO public.business_profiles(user_id) VALUES($1) RETURNING id", [user])).rows[0];
    for (const table of ["organizations", "organization_memberships", "legacy_account_organizations", "organization_access_events"]) {
      await reject(() => db.query(`SELECT * FROM public.${table}`), /permission denied/);
    }
    await reject(() => ensure(profile.id, user), /permission denied/);
    await reject(() => db.query("SELECT organization_private.ensure_legacy_organization($1,$2,$3,'service_ensure')", [profile.id, user, randomUUID()]), /permission denied/);
    await db.exec("RESET ROLE"); expect((await ensure(profile.id, user)).created).toBe(false); await validate();
  });
  it("keeps anonymous and foreign-owner insert restrictions", async () => {
    await db.exec("SET LOCAL ROLE anon"); await reject(() => ensure(), /permission denied/); await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [orgOwner]); await db.exec("SET LOCAL ROLE authenticated");
    await reject(() => db.query("INSERT INTO public.business_profiles(user_id) VALUES($1)", [randomUUID()]), /row-level security/);
  });
  it("denies direct service writes as well as private execution", async () => {
    const r = await ensure(); await db.exec("SET LOCAL ROLE service_role");
    await reject(() => db.query("UPDATE public.organizations SET lifecycle='archived' WHERE id=$1", [r.organization_id]), /permission denied/);
    await reject(() => db.query("INSERT INTO public.organizations DEFAULT VALUES"), /permission denied/);
    await reject(() => db.query("DELETE FROM public.organization_access_events"), /permission denied/);
    await reject(() => db.query("SELECT organization_private.assert_shadow_organization($1)", [r.organization_id]), /permission denied/);
  });
  it("rejects unexpected owner, missing/null profile and unsupported isolation", async () => {
    await reject(() => ensure(orgProfile, orgOther), /owner mismatch/);
    await reject(() => ensure(randomUUID()), /profile missing/);
    await reject(() => db.query("SELECT public.ensure_legacy_organization(NULL,$1,$2)", [orgOwner, randomUUID()]), /Invalid shadow/);
    expect(await snapshot()).toMatchObject({ organizations: [], memberships: [], mappings: [], events: [] });
  });
  it("never reprovisions on ordinary upsert, settings, name and data-version updates", async () => {
    await ensure(); const before = await snapshot();
    await db.query("INSERT INTO public.business_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id", [orgOwner]);
    await db.query("UPDATE public.business_profiles SET business_name='New business name',min_cash_reserve=NULL,data_version='new-version',onboarding_completed_at=now() WHERE id=$1", [orgProfile]);
    expect(await snapshot()).toEqual(before); await validate();
    await reject(() => db.query("UPDATE public.business_profiles SET user_id=$1 WHERE id=$2", [randomUUID(), orgProfile]), /identity cannot be reassigned/);
    await reject(() => db.query("UPDATE public.business_profiles SET id=$1 WHERE id=$2", [randomUUID(), orgProfile]), /identity cannot be reassigned/);
  });
  it.each(["organizations", "organization_memberships", "legacy_account_organizations", "organization_access_events"])("rolls back a new profile when the %s insert fails", async table => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.exec(`CREATE FUNCTION pg_temp.fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected stage failure'; END $$;
      CREATE TRIGGER fail_stage AFTER INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_stage()`);
    await reject(() => db.query("INSERT INTO public.business_profiles(user_id) VALUES($1)", [user]), /injected stage/);
    expect((await db.query("SELECT id FROM public.business_profiles WHERE user_id=$1", [user])).rows).toHaveLength(0);
    expect(await snapshot()).toMatchObject({ organizations: [], memberships: [], mappings: [], events: [] });
  });
  it("rolls back partial backfill while retaining the original profile", async () => {
    await db.exec(`CREATE FUNCTION pg_temp.fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected backfill failure'; END $$;
      CREATE TRIGGER fail_stage AFTER INSERT ON public.organization_access_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_stage()`);
    await reject(() => ensure(), /injected backfill/);
    expect((await db.query("SELECT data_version FROM public.business_profiles WHERE id=$1", [orgProfile])).rows[0]).toEqual({ data_version: "keep-version" });
    expect(await snapshot()).toMatchObject({ organizations: [], memberships: [], mappings: [], events: [] });
  });
  it("catches deferred incomplete graphs before commit", async () => {
    await reject(async () => { await db.query("INSERT INTO public.organizations DEFAULT VALUES"); await validate(); }, /mapping missing/);
    expect(await snapshot()).toMatchObject({ organizations: [] });
  });
  it("rolls back newly inserted profile/graph on a late deferred failure", async () => {
    const user = randomUUID(); await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.exec(`CREATE FUNCTION pg_temp.fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected deferred failure'; END $$;
      CREATE CONSTRAINT TRIGGER fail_at_commit AFTER INSERT ON public.organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_stage()`);
    await reject(async () => { await db.query("INSERT INTO public.business_profiles(user_id) VALUES($1)", [user]); await validate(); }, /injected deferred/);
    expect((await db.query("SELECT id FROM public.business_profiles WHERE user_id=$1", [user])).rows).toHaveLength(0);
    expect(await snapshot()).toMatchObject({ organizations: [] });
  });
  it("forbids extra members, unsupported modes/roles and historical rewrites", async () => {
    const r = await ensure();
    await reject(() => db.query("INSERT INTO public.organization_memberships(organization_id,user_id,legacy_subject_user_id) VALUES($1,$2,$2)", [r.organization_id, orgOther]), /unique constraint/);
    await reject(() => db.query("INSERT INTO public.organizations(kind) VALUES('practice')"), /check constraint/);
    await reject(() => db.query("INSERT INTO public.organizations(access_mode) VALUES('enabled')"), /check constraint/);
    await reject(() => db.query("UPDATE public.organization_memberships SET role='admin' WHERE id=$1", [r.membership_id]), /cannot be regranted/);
    await reject(() => db.query("DELETE FROM public.organizations WHERE id=$1", [r.organization_id]), /cannot be deleted/);
    await reject(() => db.query("UPDATE public.organization_access_events SET origin='service_ensure'"), /cannot be deleted or rewritten/);
    await reject(() => db.query("UPDATE public.legacy_account_organizations SET provisioning_operation_id=$1", [randomUUID()]), /mapping is immutable/);
  });
  it("archives profile deletion, preserves history and provisions a fresh replacement independently", async () => {
    const old = await ensure(); await db.query("DELETE FROM public.business_profiles WHERE id=$1", [orgProfile]); await validate();
    expect((await db.query("SELECT lifecycle,access_revision FROM public.organizations WHERE id=$1", [old.organization_id])).rows[0]).toMatchObject({ lifecycle: "archived", access_revision: 2 });
    expect((await db.query("SELECT status,user_id FROM public.organization_memberships WHERE id=$1", [old.membership_id])).rows[0]).toEqual({ status: "revoked", user_id: orgOwner });
    expect((await db.query("SELECT event_type FROM public.organization_access_events WHERE organization_id=$1", [old.organization_id])).rows).toHaveLength(2);
    await reject(() => db.query("INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2)", [orgProfile, orgOwner]), /mapping conflict/);
    const replacement = randomUUID(); await db.query("INSERT INTO public.business_profiles(id,user_id) VALUES($1,$2)", [replacement, orgOwner]);
    expect((await ensure(replacement)).organization_id).not.toBe(old.organization_id); await validate();
  });
  it("tombstones the membership during a real Auth cascade without deleting organization history", async () => {
    const fresh = await newProfile(), r = await ensure(fresh.id, fresh.user);
    await db.query("DELETE FROM auth.users WHERE id=$1", [fresh.user]); await validate();
    expect((await db.query("SELECT status,user_id,legacy_subject_user_id FROM public.organization_memberships WHERE id=$1", [r.membership_id])).rows[0]).toEqual({ status: "revoked", user_id: null, legacy_subject_user_id: fresh.user });
    expect((await db.query("SELECT lifecycle FROM public.organizations WHERE id=$1", [r.organization_id])).rows[0]).toEqual({ lifecycle: "archived" });
    expect((await db.query("SELECT id FROM public.organization_access_events WHERE organization_id=$1", [r.organization_id])).rows).toHaveLength(2);
  });
  it("preserves an existing FK's refusal of Auth deletion and all shadow values", async () => {
    await ensure(); await db.query("INSERT INTO public.cfo_calls(user_id) VALUES($1)", [orgOwner]); const before = await snapshot();
    await reject(() => db.query("DELETE FROM auth.users WHERE id=$1", [orgOwner]), /foreign key constraint/);
    expect(await snapshot()).toEqual(before); await validate();
  });
  it("fails safe on an unexpected preinstallation trigger and on stronger transaction isolation", async () => {
    const alternate = new PGlite();
    try {
      await alternate.exec(orgBootstrap);
      await alternate.exec("CREATE TRIGGER unexpected_profile_hook BEFORE INSERT ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()");
      await expect(alternate.exec(orgMigration())).rejects.toThrow(/unexpected profile or Auth triggers/);
      await alternate.exec("ROLLBACK");
      expect((await alternate.query<{ id: string | null }>("SELECT to_regclass('public.organizations')::text AS id")).rows[0].id).toBeNull();
      await alternate.exec("DROP TRIGGER unexpected_profile_hook ON public.business_profiles"); await alternate.exec(orgMigration());
      await alternate.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await expect(alternate.query("SELECT public.ensure_legacy_organization($1,$2,$3)", [orgProfile, orgOwner, randomUUID()])).rejects.toThrow(/READ COMMITTED/);
      await alternate.exec("ROLLBACK");
    } finally { await alternate.close(); }
  }, 60000);
});
