import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { prepareForecastReview, type ForecastReviewCommand, type ForecastReviewEvidence } from "../lib/forecastReviewStorage";

const migration = (name: string) => readFileSync(new URL(`../docs/migrations/${name}.sql`, import.meta.url), "utf8");
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const forecast = "30000000-0000-4000-8000-000000000001";
const version = "40000000-0000-4000-8000-000000000001";
const planned = "50000000-0000-4000-8000-000000000001";
let db: PGlite;
let week: string;
let eventId: string;
const policy = { version: "variance-1", currencyPrecision: 2, absoluteAmountThreshold: 100,
  percentageOfPlannedThreshold: 0.1, timingDaysThreshold: 2 };

async function evidence() {
  const { rows } = await db.query<{ value: ForecastReviewEvidence }>(
    "SELECT public.cash_forecast_review_evidence($1,$2,$3) AS value", [owner, version, week]);
  return rows[0].value;
}
async function command() {
  return prepareForecastReview(owner, await evidence(), { requestKey: randomUUID(),
    evaluationDate: new Date().toISOString().slice(0, 10), openingCash: 1000, closingCash: 1090, policy,
    allocations: [{ id: randomUUID(), plannedItemId: planned, actualEventId: eventId,
      plannedAmount: 100, actualAmount: 90, resolution: "matched", method: "user_confirmed",
      confidence: "confirmed", rationale: "Customer settled invoice", matchingPolicyVersion: "matching-1" }] });
}
async function save(c: ForecastReviewCommand) {
  const { rows } = await db.query<{ value: { review_id: string; revision: number; coverage: string; replayed: boolean } }>(
    "SELECT public.save_cash_forecast_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value",
    [c.userId, c.versionId, c.weekStart, c.requestKey, c.evidenceToken,
      JSON.stringify(c.allocations), JSON.stringify(c.policy), c.openingCash, c.closingCash, JSON.stringify(c.result)]);
  return rows[0].value;
}
async function rejected(sql: string, params: unknown[] = []) {
  await db.exec("SAVEPOINT rejected_probe");
  try { await db.query(sql, params); throw new Error("Probe unexpectedly succeeded"); }
  catch (error) { expect(String(error)).not.toContain("Probe unexpectedly succeeded"); }
  finally { await db.exec("ROLLBACK TO SAVEPOINT rejected_probe; RELEASE SAVEPOINT rejected_probe"); }
}
async function rejectsSave(c: ForecastReviewCommand, message: RegExp) {
  await db.exec("SAVEPOINT rejected_save");
  try { await expect(save(c)).rejects.toThrow(message); }
  finally { await db.exec("ROLLBACK TO SAVEPOINT rejected_save; RELEASE SAVEPOINT rejected_save"); }
}
const event = (date: string, amount = 90) => ({ reporting_currency: "USD", cash_date: date, amount,
  direction: "inflow", category: "customer_receipt", source_type: "manual", source_connection: "manual-ledger",
  source_event_id: "receipt-1", source_created_at: null, source_updated_at: null,
  ingestion_batch: "batch-1", payload_fingerprint: `receipt-${amount}`, lineage: { note: "owner entry" }, manual_entry: true });

describe("FORECAST-01E3 PostgreSQL storage", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      CREATE TABLE public.business_profiles(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id));`);
    await db.exec(migration("2026-10-25-cash-forecast-storage"));
    await db.exec(migration("2026-10-26-repair-cash-forecast-publish-permissions"));
    await db.exec(migration("2026-10-27-forecast-variance-storage"));
  }, 60000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec(`BEGIN;
      INSERT INTO auth.users VALUES('${owner}'),('${other}');
      INSERT INTO public.business_profiles VALUES('${business}','${owner}');
      INSERT INTO public.cash_forecasts(id,user_id,business_id,reporting_currency,archived_at)
        VALUES('${forecast}','${owner}','${business}','USD',now());
      INSERT INTO public.cash_forecast_versions(id,forecast_id,user_id,version_number,as_of_date,start_date,starting_included_cash,formula_policy_version,created_by)
        VALUES('${version}','${forecast}','${owner}',1,current_date-14,current_date-14,1000,'forecast-1','${owner}');
      INSERT INTO public.cash_forecast_items(id,version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,created_by,updated_by)
        VALUES('${planned}','${version}','${owner}','invoice','Invoice',100,'inflow','customer_receipt',current_date-13,'confirmed','confirmed','manual','${owner}','${owner}');
      UPDATE public.cash_forecast_versions SET status='published',calculation_result='{}',published_by='${owner}',published_at=now() WHERE id='${version}';`);
    week = (await db.query<{ day: string }>("SELECT (current_date-14)::text AS day")).rows[0].day;
    const cashDate = (await db.query<{ day: string }>("SELECT (current_date-13)::text AS day")).rows[0].day;
    eventId = (await db.query<{ value: { event_id: string } }>(
      "SELECT public.record_cash_actual_event($1,$2,$3) AS value", [owner, business, JSON.stringify(event(cashDate))])).rows[0].value.event_id;
  });
  afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE"); });

  it("saves the real engine output with immutable snapshots, exact retry and a revision chain", async () => {
    const c = await command();
    const first = await save(c);
    expect(first).toMatchObject({ revision: 1, coverage: "complete", replayed: false });
    expect(await save(c)).toEqual({ ...first, replayed: true });
    const next = await command();
    const second = await save(next);
    expect(second.revision).toBe(2);
    const { rows } = await db.query<{ previous_review_id: string; source_snapshot: { actual_events: unknown[] }; calculation_result: unknown }>(
      "SELECT * FROM public.cash_forecast_reviews WHERE id=$1", [second.review_id]);
    expect(rows[0].previous_review_id).toBe(first.review_id);
    expect(rows[0].source_snapshot.actual_events).toHaveLength(1);
    expect(rows[0].calculation_result).toEqual(next.result);
    await rejected("UPDATE public.cash_forecast_reviews SET coverage='unknown'");
    await rejected("DELETE FROM public.cash_forecast_review_allocations");
    await rejected("UPDATE public.cash_actual_events SET amount=1");
  });

  it("preserves earlier evidence after source correction and rejects stale calculations", async () => {
    const first = await save(await command());
    const stale = await command();
    const date = (await evidence()).actual_events[0].cash_date;
    const corrected = (await db.query<{ value: { event_id: string; revision: number } }>(
      "SELECT public.record_cash_actual_event($1,$2,$3,$4) AS value",
      [owner, business, JSON.stringify(event(date, 95)), eventId])).rows[0].value;
    expect(corrected.revision).toBe(2);
    expect((await evidence()).actual_events.map(e => e.id)).toEqual([corrected.event_id]);
    await rejectsSave(stale, /evidence changed/);
    const snapshot = (await db.query<{ amount: number }>(
      "SELECT (source_snapshot->'actual_events'->0->>'amount')::float AS amount FROM public.cash_forecast_reviews WHERE id=$1", [first.review_id])).rows[0];
    expect(snapshot.amount).toBe(90);
    await rejected("SELECT public.record_cash_actual_event($1,$2,$3,$4)", [owner, business, JSON.stringify(event(date, 96)), eventId]);
  });

  it("deduplicates unchanged source evidence when a later ingestion batch repeats it", async () => {
    const date = (await evidence()).actual_events[0].cash_date;
    const payload = { ...event(date), ingestion_batch: "batch-2" };
    const retry = (await db.query<{ value: { event_id: string; replayed: boolean; revision: number } }>(
      "SELECT public.record_cash_actual_event($1,$2,$3) AS value", [owner, business, JSON.stringify(payload)])).rows[0].value;
    expect(retry).toEqual({ event_id: eventId, replayed: true, revision: 1 });
    expect((await evidence()).actual_events).toHaveLength(1);
  });

  it("rejects a second writer's stale head, changed retry payload and over-allocation without partial rows", async () => {
    const first = await command();
    const competing = await command();
    await save(first);
    await rejectsSave(competing, /evidence changed/);
    await rejectsSave({ ...first, closingCash: 0 }, /Request key reused/);
    const excess = await command();
    excess.allocations[0].actualAmount = 91;
    await rejectsSave(excess, /exceeds/);
    const precision = await command();
    precision.allocations[0].actualAmount = 89.99999;
    await rejectsSave(precision, /precision/);
    const lateFailure = await command();
    lateFailure.allocations[0].rationale = "";
    await rejectsSave(lateFailure, /check constraint/);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.cash_forecast_reviews")).rows[0].count).toBe(1);
  });

  it("enforces owner RLS, least privilege and service-only operations", async () => {
    await save(await command());
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [other]);
    await db.exec("SET LOCAL ROLE authenticated");
    for (const table of ["cash_actual_events", "cash_forecast_reviews", "cash_forecast_review_allocations"]) {
      expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`)).rows[0].count).toBe(0);
    }
    await rejected("SELECT public.cash_forecast_review_evidence($1,$2,$3)", [owner, version, week]);
    await db.exec("RESET ROLE; SET LOCAL ROLE service_role");
    await rejected("DELETE FROM public.cash_actual_events");
    expect((await evidence()).actual_events).toHaveLength(1);
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec("SET LOCAL ROLE authenticated");
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM public.cash_actual_events")).rows[0].count).toBe(1);
  });

  it("rejects cross-account references, opposite directions, nonclosed weeks and false completion", async () => {
    const c = await command();
    await rejectsSave({ ...c, userId: other }, /Business not found/);
    await rejected("SELECT public.cash_forecast_review_evidence($1,$2,current_date)", [owner, version]);
    c.allocations[0].actualEventId = randomUUID();
    await rejectsSave(c, /same-week/);
    const falseComplete = await command();
    falseComplete.closingCash = 1091;
    await rejectsSave(falseComplete, /cannot be complete/);
    const wrongDirection = await command();
    const date = (await evidence()).actual_events[0].cash_date;
    const newEvent = { ...event(date), source_event_id: "withdrawal", direction: "outflow", category: "payroll" };
    const id = (await db.query<{ value: { event_id: string } }>("SELECT public.record_cash_actual_event($1,$2,$3) AS value",
      [owner, business, JSON.stringify(newEvent)])).rows[0].value.event_id;
    wrongDirection.evidenceToken = (await evidence()).evidence_token;
    wrongDirection.allocations[0].actualEventId = id;
    await rejectsSave(wrongDirection, /direction/);
  });

  it("keeps incomplete reviews partial and isolates the immutable retry command from edits", async () => {
    const e = await evidence();
    const options = { requestKey: randomUUID(), evaluationDate: new Date().toISOString().slice(0, 10),
      openingCash: null, closingCash: null, policy: { ...policy }, allocations: [] };
    const c = prepareForecastReview(owner, e, options);
    options.policy.version = "edited";
    expect(c.policy.version).toBe("variance-1");
    expect(await save(c)).toMatchObject({ coverage: "partial" });
  });

  it("runs the same rollback verifier that will be executed in preview", async () => {
    await db.query("SELECT set_config('app.preview_confirmed','true',false),set_config('app.preview_account_a',$1,false),set_config('app.preview_account_b',$2,false)", [owner, other]);
    await db.exec(migration("verify-forecast-variance-storage"));
  });
});
