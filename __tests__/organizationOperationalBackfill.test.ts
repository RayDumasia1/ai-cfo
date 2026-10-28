import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orgBootstrap, orgMigration } from "./fixtures/organizationDb";
import { legacyFingerprint } from "../scripts/organization-shadow-tools.mjs";
const operationalSql = readFileSync(new URL("../docs/migrations/2026-10-28-organization-shadow-backfill.sql", import.meta.url), "utf8");
let db: PGlite;
async function runBatch() {
  const results = await db.exec(operationalSql);
  return results.at(-1)!.rows[0] as { status: string; profiles: number; active_organizations: number; unmapped_profiles: number; conflicting_mappings: number };
}
describe("reviewed production SQL operational backfill", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec(orgBootstrap);
    await db.exec("INSERT INTO auth.users(id) SELECT gen_random_uuid() FROM generate_series(1,101); INSERT INTO public.business_profiles(user_id) SELECT u.id FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM public.business_profiles p WHERE p.user_id=u.id)");
  }, 60000);
  afterAll(async () => { await db?.close(); });
  it("refuses execution before the reviewed expansion exists", async () => {
    await expect(runBatch()).rejects.toThrow(/Install the reviewed/); await db.exec("ROLLBACK");
    expect((await db.query("SELECT to_regclass('public.organizations')::text AS value")).rows[0]).toEqual({ value: null });
  });
  it("commits at most 100 profiles per run, reports remaining work, and replays without legacy changes", async () => {
    const before = await legacyFingerprint(db); await db.exec(orgMigration());
    const first = await runBatch(); expect(first.status).toBe("RUN_NEXT_BATCH"); expect(Number(first.active_organizations)).toBe(100); expect(Number(first.unmapped_profiles)).toBe(3);
    const second = await runBatch(); expect(second.status).toBe("COMPLETE"); expect(Number(second.profiles)).toBe(103); expect(Number(second.active_organizations)).toBe(103); expect(Number(second.unmapped_profiles)).toBe(0); expect(Number(second.conflicting_mappings)).toBe(0);
    const events = (await db.query("SELECT * FROM public.organization_access_events ORDER BY id")).rows;
    expect(await runBatch()).toEqual(second);
    expect((await db.query("SELECT * FROM public.organization_access_events ORDER BY id")).rows).toEqual(events);
    expect(await legacyFingerprint(db)).toEqual(before);
  });
  it("stops for privilege or hook drift without attempting a repair", async () => {
    await db.exec("GRANT SELECT ON public.organizations TO anon");
    await expect(runBatch()).rejects.toThrow(/Unexpected shadow table privileges/); await db.exec("ROLLBACK; REVOKE SELECT ON public.organizations FROM anon");
    await db.exec("ALTER TABLE public.business_profiles DISABLE TRIGGER organization_profile_provisioned");
    await expect(runBatch()).rejects.toThrow(/hooks are not enabled/); await db.exec("ROLLBACK; ALTER TABLE public.business_profiles ENABLE TRIGGER organization_profile_provisioned");
    expect((await runBatch()).status).toBe("COMPLETE");
  });
});
