import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { batchSize, previewConnection, backfillOrganizations, legacyFingerprint, readOnlyPlan } from "../scripts/organization-shadow-tools.mjs";
import { orgBootstrap, orgMigration } from "./fixtures/organizationDb";
let db: PGlite;
describe("shadow organization operator", () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(orgBootstrap); }, 60000);
  afterAll(async () => { await db?.close(); });
  it("guards preview identity and batch budgets before any database call", () => {
    const env = { PREVIEW_DATABASE_URL: "postgresql://postgres.previewref:private@aws-0.pooler.supabase.com:5432/postgres", PREVIEW_PROJECT_REF: "previewref", NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co" };
    expect(previewConnection(env)).toBe(env.PREVIEW_DATABASE_URL);
    expect(() => previewConnection({ ...env, PREVIEW_PROJECT_REF: "different" })).toThrow(/mismatch/);
    expect(() => previewConnection({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://productionref.supabase.co" })).toThrow(/mismatch/);
    expect(() => previewConnection({ ...env, PREVIEW_DATABASE_URL: "postgresql://postgres.previewref:private@attacker.invalid/postgres" })).toThrow(/mismatch/);
    for (const n of [0, -1, 501, 1.1, "not-a-number"]) expect(() => batchSize(n)).toThrow();
    expect(batchSize("100")).toBe(100);
  });
  it("plans in a read-only transaction before and after installation", async () => {
    const before = await legacyFingerprint(db);
    expect(await readOnlyPlan(db)).toMatchObject({ installed: false, profiles: 2, unmapped: 2 });
    expect(await legacyFingerprint(db)).toEqual(before);
    await db.exec(orgMigration());
    expect(await readOnlyPlan(db)).toMatchObject({ installed: true, profiles: 2, active: 0, unmapped: 2 });
    expect(await legacyFingerprint(db)).toEqual(before);
  });
  it("resumes a partially committed run without changing legacy rows or previously committed metadata", async () => {
    const before = await legacyFingerprint(db);
    await expect(backfillOrganizations(db, { batchSize: 1, onBatch: () => { throw new Error("operator interrupted"); } })).rejects.toThrow("operator interrupted");
    expect(await readOnlyPlan(db)).toMatchObject({ active: 1, unmapped: 1 });
    const committed = (await db.query<{ id: string }>("SELECT * FROM public.organization_access_events")).rows;
    const result = await backfillOrganizations(db, { batchSize: 1 });
    expect(result).toMatchObject({ created: 1, batches: 1, report: { active: 2, unmapped: 0, conflicting_mappings: 0 } });
    expect((await db.query("SELECT * FROM public.organization_access_events WHERE id=$1", [committed[0].id])).rows).toEqual(committed);
    expect(await legacyFingerprint(db)).toEqual(before);
    const events = (await db.query("SELECT * FROM public.organization_access_events ORDER BY id")).rows;
    expect(await backfillOrganizations(db)).toMatchObject({ created: 0, batches: 0 });
    expect((await db.query("SELECT * FROM public.organization_access_events ORDER BY id")).rows).toEqual(events);
  });
  it("refuses apply against missing or partial installation", async () => {
    const alternate = new PGlite();
    try {
      await alternate.exec(orgBootstrap);
      await expect(backfillOrganizations(alternate)).rejects.toThrow(/Install the reviewed expansion/);
      await alternate.exec("CREATE TABLE public.organizations(id uuid)");
      await expect(readOnlyPlan(alternate)).rejects.toThrow(/Partial shadow installation/);
    } finally { await alternate.close(); }
  }, 60000);
  it("bounds transient lock retries and rolls back each failed batch", async () => {
    const fake = { query: vi.fn(async (sql: string) => {
      if (sql.includes("AS tables")) return { rows: [{ tables: 4, wrapper: true, hooks: 2 }] };
      if (sql.includes("SELECT p.id,p.user_id")) throw Object.assign(new Error("lock contention"), { code: "55P03" });
      return { rows: [] };
    }), end: vi.fn(async () => {}) };
    await expect(backfillOrganizations(fake)).rejects.toMatchObject({ code: "55P03" });
    expect(fake.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(4);
    expect(fake.end).not.toHaveBeenCalled();
  });
  it("terminates a hung batch connection at its deadline instead of retrying uncertain work", async () => {
    let cancel = () => {};
    const fake = { query: vi.fn(async (sql: string) => {
      if (sql.includes("AS tables")) return { rows: [{ tables: 4, wrapper: true, hooks: 2 }] };
      if (sql.includes("SELECT p.id,p.user_id")) return await new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error("connection terminated")); });
      return { rows: [] };
    }), end: vi.fn(async () => { cancel(); }) };
    await expect(backfillOrganizations(fake, { deadlineMs: 30 })).rejects.toMatchObject({ code: "ORG_BATCH_DEADLINE" });
    expect(fake.end).toHaveBeenCalledTimes(1);
    expect(fake.query.mock.calls.filter(([sql]) => sql.startsWith("BEGIN"))).toHaveLength(1);
  });
});
