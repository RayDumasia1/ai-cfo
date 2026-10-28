import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
const owner = "11000000-0000-4000-8000-000000000001", other = "11000000-0000-4000-8000-000000000002", business = "22000000-0000-4000-8000-000000000001";
let db: PGlite;
type RecordValue = { id: string; generation: string; operationId: string; status: string; envelope?: unknown; credentialGeneration?: string; credentialRevision: number };
const state = "a".repeat(64), browser = "b".repeat(64);
const call = async (action: string, input: object = {}, actor = owner) => (await db.query<{ v: RecordValue }>("SELECT public.quickbooks_lifecycle($1,$2,$3,$4) AS v", [actor, business, action, JSON.stringify(input)])).rows[0].v;
const op = (c: RecordValue) => ({ generation: c.generation, operationId: c.operationId });
const credentials = () => ({ envelope: { version: 1, keyId: "test", ciphertext: "encrypted-not-plaintext" }, accessExpiresAt: "2099-01-01", refreshExpiresAt: "2099-02-01" });
async function linked() {
  await call("start", { stateHash: state, browserHash: browser });
  const c = await call("claim", { stateHash: state, browserHash: browser, realmId: "123" });
  await call("store_grant", { ...op(c), ...credentials() }); return await call("verify", { ...op(c), companyName: "Sandbox" });
}
async function reject(fn: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("SAVEPOINT probe"); try { await expect(fn()).rejects.toThrow(pattern); } finally { await db.exec("ROLLBACK TO SAVEPOINT probe; RELEASE SAVEPOINT probe"); }
}
describe("INT-01B PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.business_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL,data_version text DEFAULT 'original');
      CREATE TABLE public.financial_months(user_id uuid);
      CREATE TABLE public.subscriptions(user_id uuid PRIMARY KEY,feature_tier text,status text,plan text,stripe_subscription_id text);
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
      GRANT SELECT,UPDATE ON public.business_profiles TO service_role; GRANT SELECT ON public.subscriptions TO service_role;`);
    await db.exec(readFileSync(new URL("../docs/migrations/2026-10-28-quickbooks-connection-lifecycle.sql", import.meta.url), "utf8"));
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec(`BEGIN; INSERT INTO auth.users VALUES('${owner}'),('${other}'); INSERT INTO public.business_profiles(id,user_id) VALUES('${business}','${owner}'); INSERT INTO public.subscriptions VALUES('${owner}','core','active','core',NULL);`); });
  afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE"); });
  it("claims a browser-bound intent once and requires verified company metadata", async () => {
    await db.exec("SET LOCAL ROLE service_role"); await call("start", { stateHash: state, browserHash: browser });
    await reject(() => call("claim", { stateHash: state, browserHash: "c".repeat(64), realmId: "123" }), /Invalid or expired/);
    const c = await call("claim", { stateHash: state, browserHash: browser, realmId: "123" }); expect(c.status).toBe("exchanging");
    await reject(() => call("claim", { stateHash: state, browserHash: browser, realmId: "123" }), /Invalid or expired/);
    await reject(() => call("verify", { ...op(c), companyName: "Sandbox" }), /Company verification required/);
    await call("store_grant", { ...op(c), ...credentials() });
    expect((await call("verify", { ...op(c), companyName: "Sandbox" })).status).toBe("connected");
    expect(await call("read")).not.toHaveProperty("envelope");
  });
  it("rejects expired intents and invalidates earlier starts without exchanging codes", async () => {
    await call("start", { stateHash: state, browserHash: browser });
    await call("start", { stateHash: "c".repeat(64), browserHash: browser });
    await reject(() => call("claim", { stateHash: state, browserHash: browser, realmId: "123" }), /Invalid or expired/);
    await db.exec("UPDATE public.quickbooks_connections SET intent_expires_at=now()-interval '1 second'");
    await reject(() => call("claim", { stateHash: "c".repeat(64), browserHash: browser, realmId: "123" }), /Invalid or expired/);
  });
  it("forbids direct browser access and cross-workspace service requests", async () => {
    await linked();
    await reject(() => call("read", {}, other), /Workspace not found/);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(() => call("read"), /permission denied/);
      for (const table of ["quickbooks_connections", "quickbooks_credentials", "quickbooks_connection_audit"]) await reject(() => db.query(`SELECT * FROM public.${table}`), /permission denied/);
      await db.exec("RESET ROLE");
    }
  });
  it("serializes refreshes, persists rotation, and clears the completed operation", async () => {
    await linked(); const c = await call("refresh_claim"); expect(c.envelope).toBeTruthy();
    await reject(() => call("refresh_claim"), /Reconnect or finish/); await reject(() => call("disconnect_claim"), /in progress/);
    const next = await call("refresh_finish", { ...op(c), ...credentials() }); expect(next.status).toBe("connected"); expect(next.credentialRevision).toBe(2); expect(next.operationId).toBeNull();
    await reject(() => call("refresh_finish", { ...op(c), ...credentials() }), /operation changed/);
  });
  it("immediately fences local access, rotates generation and keeps only encrypted revocation recovery", async () => {
    const connected = await linked(), c = await call("disconnect_claim"); expect(c.generation).not.toBe(connected.generation); expect(c.credentialGeneration).toBe(connected.generation);
    expect(c.envelope).toBeTruthy(); await call("disconnect_fail", op(c));
    await reject(() => call("start", { stateHash: state, browserHash: browser }), /Disconnect the existing/);
    const retry = await call("disconnect_claim"); expect(retry.status).toBe("revoking");
    expect((await call("disconnect_finish", op(retry))).status).toBe("disconnected");
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.quickbooks_credentials")).rows[0].n).toBe(0);
    await call("start", { stateHash: state, browserHash: browser });
    await reject(() => call("disconnect_finish", op(retry)), /operation changed/);
  });
  it("requires paid Core for connecting and refreshing, while permitting downgrade disconnect", async () => {
    await linked(); await db.exec("UPDATE public.subscriptions SET status='cancelled'");
    await reject(() => call("refresh_claim"), /Core subscription required/); expect((await call("disconnect_claim")).status).toBe("revoking");
  });
  it("retains newly rotated credentials without restoring access after entitlement loss", async () => {
    await linked(); const c = await call("refresh_claim"); await db.exec("UPDATE public.subscriptions SET feature_tier='starter'");
    expect((await call("refresh_finish", { ...op(c), ...credentials() })).status).toBe("reconnect_required");
    expect((await call("disconnect_claim")).envelope).toBeTruthy();
  });
  it("never reclaims a timed-out refresh for a second refresh, and fences late completions after disconnect", async () => {
    await linked(); const c = await call("refresh_claim");
    await db.exec("UPDATE public.quickbooks_connections SET operation_started_at=now()-interval '3 minutes'");
    await reject(() => call("refresh_claim"), /Reconnect or finish/);
    const stopped = await call("disconnect_claim"); expect(stopped.status).toBe("revoking");
    await reject(() => call("refresh_finish", { ...op(c), ...credentials() }), /operation changed/);
  });
  it("binds cancellation to both nonce hashes and invalidates the intent", async () => {
    const c = await call("start", { stateHash: state, browserHash: browser });
    const end = await call("cancel_intent", { stateHash: state, browserHash: browser }); expect(end.status).toBe("disconnected"); expect(end.generation).not.toBe(c.generation);
    await reject(() => call("claim", { stateHash: state, browserHash: browser, realmId: "123" }), /Invalid or expired/);
  });
  it("executes the same rollback-only verifier used against Supabase preview", async () => {
    await db.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)", [owner, other]);
    await db.exec(readFileSync(new URL("../docs/migrations/verify-quickbooks-connection-lifecycle.sql", import.meta.url), "utf8"));
  });
});
