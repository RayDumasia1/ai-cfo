import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/foundingMembers", () => ({
  getFoundingMemberAvailability: vi.fn(async () => ({ soldOut: false })),
  upsertNewFoundingMember: vi.fn(),
}));
vi.mock("../lib/email", () => ({
  sendCfoCallConfirmation: vi.fn(), sendPaymentFailedEmail: vi.fn(),
  sendFoundingMemberWelcomeEmail: vi.fn(), sendFoundingMemberRestoreEmail: vi.fn(),
  sendFoundingMemberCancelledEmail: vi.fn(),
}));
vi.mock("../lib/stripe", () => ({
  stripe: {
    customers: { create: vi.fn(), retrieve: vi.fn() },
    subscriptions: { list: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() },
    invoicePayments: { list: vi.fn() },
    refunds: { create: vi.fn() },
    billingPortal: { sessions: { create: vi.fn() } },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), list: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  },
  STRIPE_PRICES: { starter: "price_starter", core: "price_core", founding_member: "price_founding", cfo_call: "price_call" },
  PLAN_TO_TIER: { starter: "starter", core: "core", founding_member: "core" },
}));

import { stripe } from "../lib/stripe";
import { createServiceClient } from "../utils/supabase/service";
import { createClient } from "../utils/supabase/server";
import { POST as checkout } from "../app/api/stripe/checkout/route";
import { POST as webhook } from "../app/api/stripe/webhook/route";
import { ensureBillingCustomer } from "../lib/db";
import { sendPaymentFailedEmail, sendFoundingMemberCancelledEmail } from "../lib/email";
import { getFoundingMemberAvailability, upsertNewFoundingMember } from "../lib/foundingMembers";
import { POST as reactivate } from "../app/api/stripe/reactivate/route";

type Row = Record<string, unknown>;

// In-memory PostgREST double: executes filtered writes when awaited, including
// ON CONFLICT DO NOTHING and compare-and-delete. No Supabase/Stripe network calls.
function database() {
  const tables: Record<string, Row[]> = { subscriptions: [], subscription_checkout_attempts: [], usage_tracking: [], stripe_webhook_events: [] };
  const writes: { table: string; filters: [string, unknown][]; values: Row }[] = [];
  let failTable: string | null = null;
  const client = {
    async rpc(name: string, args: Row) {
      if (name !== "claim_stripe_webhook_event") return { data: null, error: new Error("Unknown RPC") };
      if (failTable === "stripe_webhook_events") return { data: null, error: new Error("Database unavailable") };
      const rows = tables.stripe_webhook_events;
      const existing = rows.find(row => row.event_id === args.p_event_id);
      if (existing && existing.status !== "failed") return { data: false, error: null };
      if (existing) Object.assign(existing, { status: "processing", attempts: Number(existing.attempts) + 1 });
      else rows.push({ event_id: args.p_event_id, event_type: args.p_event_type, object_id: args.p_object_id, status: "processing", attempts: 1 });
      return { data: true, error: null };
    },
    from(table: string) {
      let operation = "select";
      let values: Row = {};
      let ignoreDuplicates = false;
      const filters: [string, unknown][] = [];
      const builder = {
        select() { return builder; },
        upsert(row: Row, options?: { ignoreDuplicates?: boolean }) {
          operation = "upsert"; values = row; ignoreDuplicates = !!options?.ignoreDuplicates; return builder;
        },
        update(row: Row) { operation = "update"; values = row; return builder; },
        delete() { operation = "delete"; return builder; },
        eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
        is(key: string, value: unknown) { filters.push([key, value]); return builder; },
        neq(key: string, value: unknown) { filters.push([`!${key}`, value]); return builder; },
        lt() { return builder; },
        single: () => execute(true),
        maybeSingle: () => execute(true),
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return execute(false).then(resolve, reject);
        },
      };
      async function execute(single: boolean) {
        if (table === failTable) return { data: null, error: new Error("Database unavailable") };
        // Match the actual preview CHECK: raw Stripe states must not slip
        // through a permissive database double unnoticed.
        if (table === "subscriptions" && ["upsert", "update"].includes(operation) &&
            values.status !== undefined &&
            !["active", "cancelled", "past_due", "trialing", "paused", "pending_cancellation"].includes(String(values.status))) {
          return { data: null, error: { code: "23514", message: "subscriptions_status_check" } };
        }
        const rows = tables[table] ??= [];
        const matches = (row: Row) => filters.every(([key, value]) => key.startsWith("!")
          ? row[key.slice(1)] !== value : (row[key] ?? null) === value);
        let selected = rows.filter(matches);
        if (operation === "upsert") {
          const existing = rows.find(row => row.user_id === values.user_id);
          if (existing && !ignoreDuplicates) Object.assign(existing, values);
          if (!existing) rows.push({ created_at: new Date().toISOString(), ...values });
          selected = rows.filter(row => row.user_id === values.user_id);
        }
        if (operation === "update") {
          if (table !== "stripe_webhook_events") writes.push({ table, filters: [...filters], values });
          selected.forEach(row => Object.assign(row, values));
        }
        if (operation === "delete") tables[table] = rows.filter(row => !matches(row));
        // PostgREST returns snapshots, not references into the mutable store.
        return { data: single ? (selected[0] ? { ...selected[0] } : null) : selected.map(row => ({ ...row })), error: null };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, tables, writes, fail: (table: string) => { failTable = table; } };
}

let db: ReturnType<typeof database>;
let sessions: Map<string, Row>;
let subscriptions: Row[];
let userId: string;
let invoicePayments: Row[];
let eventSequence: number;

function request(planKey = "core", mode = "subscription") {
  return new NextRequest("https://app.example.invalid/api/stripe/checkout", {
    method: "POST", body: JSON.stringify({ planKey, mode }),
  });
}

function seedSubscription(overrides: Row = {}): Row {
  const row = { user_id: userId, stripe_customer_id: "cus_existing", stripe_subscription_id: "sub_current", plan: "core", status: "active", feature_tier: "core", ...overrides };
  db.tables.subscriptions.push(row);
  return row;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = database(); sessions = new Map(); subscriptions = []; invoicePayments = []; eventSequence = 0; userId = "user_one";
  vi.mocked(getFoundingMemberAvailability).mockResolvedValue({ total: 25, claimed: 1, remaining: 24, soldOut: false });
  vi.mocked(createServiceClient).mockReturnValue(db.client);
  vi.mocked(createClient).mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" } }, error: null }) },
  }) as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(stripe.customers.create).mockImplementation(async (_params, options) => ({
    id: `cus_${options?.idempotencyKey}`,
  }) as never);
  vi.mocked(stripe.customers.retrieve).mockResolvedValue({ email: "test@example.invalid" } as never);
  vi.mocked(stripe.subscriptions.list).mockImplementation((params) => ({
    autoPagingEach: async (visit: (row: Row) => unknown) => {
      for (const row of subscriptions.filter(row => row.customer === params?.customer)) {
        if (visit(row) === false) break;
      }
    },
  }) as never);
  vi.mocked(stripe.subscriptions.retrieve).mockImplementation(async (id) => (
    subscriptions.find(row => row.id === id) ?? { id, status: "canceled", items: { data: [] } }
  ) as never);
  vi.mocked(stripe.subscriptions.cancel).mockImplementation(async id => {
    const sub = subscriptions.find(row => row.id === id);
    if (sub) sub.status = "canceled";
    return sub as never;
  });
  vi.mocked(stripe.subscriptions.update).mockResolvedValue({ status: "active" } as never);
  vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({
    url: "https://billing.stripe.example/session",
  } as never);
  vi.mocked(stripe.invoicePayments.list).mockImplementation(() => ({
    autoPagingEach: async (visit: (row: Row) => Promise<void>) => {
      for (const payment of invoicePayments) await visit(payment);
    },
  }) as never);
  vi.mocked(stripe.refunds.create).mockResolvedValue({ status: "succeeded" } as never);
  vi.mocked(stripe.checkout.sessions.create).mockImplementation(async (params, options) => {
    const key = options?.idempotencyKey ?? `payment:${sessions.size}`;
    if (!sessions.has(key)) sessions.set(key, {
      id: `cs_${sessions.size}`, url: `https://checkout.example.invalid/${sessions.size}`,
      status: "open", ...params,
    });
    return sessions.get(key) as never;
  });
  vi.mocked(stripe.checkout.sessions.retrieve).mockImplementation(async (id) => (
    [...sessions.values()].find(row => row.id === id)
  ) as never);
  vi.mocked(stripe.checkout.sessions.list).mockImplementation((params) => ({
    autoPagingEach: async (visit: (row: Row) => Promise<unknown>) => {
      for (const session of sessions.values()) {
        if (session.customer === params?.customer && session.status === "open") await visit(session);
      }
    },
  }) as never);
  vi.mocked(stripe.checkout.sessions.expire).mockImplementation(async (id) => {
    const session = [...sessions.values()].find(row => row.id === id)!;
    if (session.status !== "open") throw new Error("Session cannot be expired");
    session.status = "expired";
    return session as never;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("subscription checkout", () => {
  it("opens Stripe billing management when an active Starter subscriber upgrades to Core", async () => {
    seedSubscription({ plan: "starter", feature_tier: "starter", status: "active",
      stripe_subscription_id: "sub_starter" });
    const response = await checkout(request("core"), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.example/session",
      manage_existing: true,
    });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url: "https://app.example.invalid/dashboard/settings?tab=billing",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects an unverified account before creating customers, sessions or checkout attempts", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: userId, email: "test@example.invalid" } }, error: null }) },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    const response = await checkout(request("founding_member"), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(db.tables.subscriptions).toHaveLength(0);
    expect(db.tables.subscription_checkout_attempts).toHaveLength(0);
  });
  it("explains restoration when a cancelled account already holds a Founding Member number", async () => {
    seedSubscription({ status: "cancelled", stripe_subscription_id: null, founding_member_number: 1 });
    const response = await checkout(request("founding_member"), {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      already_member: true,
      error: expect.stringContaining("hello@elidan.ai"),
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(db.tables.subscription_checkout_attempts).toHaveLength(0);
  });

  it("creates and reuses the Founding Member checkout for an eligible new account", async () => {
    const first = await checkout(request("founding_member"), {});
    const second = await checkout(request("founding_member"), {});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(sessions.size).toBe(1);
    expect([...sessions.values()][0]).toMatchObject({
      line_items: [{ price: "price_founding", quantity: 1 }],
      metadata: { plan_key: "founding_member", supabase_user_id: userId },
    });
  });

  it("blocks a new Founding Member checkout when spots are sold out", async () => {
    vi.mocked(getFoundingMemberAvailability).mockResolvedValue({ total: 25, claimed: 25, remaining: 0, soldOut: true });
    const response = await checkout(request("founding_member"), {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ sold_out: true });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed when Founding Member availability cannot be checked", async () => {
    vi.mocked(getFoundingMemberAvailability).mockRejectedValueOnce(new Error("Database unavailable"));
    expect((await checkout(request("founding_member"), {})).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each(["active", "pending_cancellation", "past_due", "unpaid", "incomplete", "paused"])(
    "routes an existing %s subscription to billing management without creating another checkout", async (status) => {
      seedSubscription({ status });
      const response = await checkout(request(), {});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: "https://billing.stripe.example/session",
        manage_existing: true,
      });
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_existing",
        return_url: "https://app.example.invalid/dashboard/settings?tab=billing",
      });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    }
  );

  it("recovers a Stripe subscription when the database has not received its webhook", async () => {
    const row = seedSubscription({ stripe_subscription_id: null, plan: "starter", feature_tier: "starter" });
    subscriptions.push({
      id: "sub_recovered", customer: "cus_existing", status: "active", metadata: { plan_key: "core" },
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
    });
    expect((await checkout(request(), {})).status).toBe(200);
    expect(row).toMatchObject({ stripe_subscription_id: "sub_recovered", plan: "core", feature_tier: "core", status: "active" });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("repairs both missing Stripe links when the idempotent customer already has a subscription", async () => {
    const row = seedSubscription({
      plan: "starter", feature_tier: "starter", status: "cancelled",
      stripe_customer_id: null, stripe_subscription_id: null,
    });
    const customer = `cus_billing-customer:${userId}`;
    subscriptions.push({
      id: "sub_existing", customer, status: "active", metadata: { plan_key: "core" },
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
    });
    const response = await checkout(request(), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ url: expect.stringContaining("/dashboard/settings?tab=billing"), reconciled: true });
    expect(row).toMatchObject({
      stripe_customer_id: customer, stripe_subscription_id: "sub_existing",
      plan: "core", feature_tier: "core", status: "active", stripe_price_id: "price_core",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reuses one checkout across repeated and concurrent requests", async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => checkout(request(), {})));
    expect(responses.every(response => response.status === 200)).toBe(true);
    const urls = await Promise.all(responses.map(response => response.json().then(body => body.url)));
    expect(new Set(urls).size).toBe(1);
    expect(sessions.size).toBe(1);
    expect(db.tables.subscription_checkout_attempts).toHaveLength(1);
    expect(new Set(vi.mocked(stripe.checkout.sessions.create).mock.calls.map(call => call[1]?.idempotencyKey)).size).toBe(1);
  });

  it("isolates checkout attempts between accounts", async () => {
    const first = await (await checkout(request(), {})).json();
    userId = "user_two";
    const second = await (await checkout(request(), {})).json();
    expect(first.url).not.toBe(second.url);
    expect(db.tables.subscription_checkout_attempts).toHaveLength(2);
  });

  it("recovers an ambiguous Stripe timeout using the same idempotency key", async () => {
    const create = vi.mocked(stripe.checkout.sessions.create).getMockImplementation()!;
    vi.mocked(stripe.checkout.sessions.create).mockImplementationOnce(async (...args) => {
      await create(...args);
      throw new Error("Response lost after Stripe created the session");
    });
    expect((await checkout(request(), {})).status).toBe(503);
    expect((await checkout(request(), {})).status).toBe(200);
    expect(sessions.size).toBe(1);
  });

  it("does not replace a completed checkout while webhook activation is pending", async () => {
    await checkout(request(), {});
    [...sessions.values()][0].status = "complete";
    expect((await checkout(request(), {})).status).toBe(409);
    expect(sessions.size).toBe(1);
  });

  it("expires the previous session before switching plans", async () => {
    await checkout(request(), {});
    expect((await checkout(request("starter"), {})).status).toBe(200);
    expect([...sessions.values()][0].status).toBe("expired");
    expect((await checkout(request("starter"), {})).status).toBe(200);
    expect([...sessions.values()].filter(row => row.status === "open")).toHaveLength(1);
  });

  it("does not release an attempt if session expiration races with completion", async () => {
    await checkout(request(), {});
    vi.mocked(stripe.checkout.sessions.expire).mockRejectedValueOnce(new Error("Already complete"));
    expect((await checkout(request("starter"), {})).status).toBe(503);
    expect(db.tables.subscription_checkout_attempts).toHaveLength(1);
  });

  it("allows another attempt only after the existing session is confirmed expired", async () => {
    await checkout(request(), {});
    [...sessions.values()][0].status = "expired";
    expect((await checkout(request(), {})).status).toBe(200);
    expect(sessions.size).toBe(2);
  });

  it.each(["subscriptions", "subscription_checkout_attempts"])("fails closed when %s is unavailable", async table => {
    db.fail(table);
    expect((await checkout(request(), {})).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails closed when Stripe subscription verification fails", async () => {
    vi.mocked(stripe.subscriptions.list).mockImplementationOnce(() => { throw new Error("Stripe unavailable"); });
    expect((await checkout(request(), {})).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not retry ambiguous creation beyond Stripe's idempotency retention window", async () => {
    await checkout(request(), {});
    const attempt = db.tables.subscription_checkout_attempts[0];
    attempt.session_id = null;
    attempt.created_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(stripe.checkout.sessions.create).mockClear();
    expect((await checkout(request(), {})).status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("permits repurchase after a terminal subscription", async () => {
    seedSubscription({ status: "cancelled" });
    subscriptions.push({ customer: "cus_existing", status: "canceled" });
    expect((await checkout(request(), {})).status).toBe(200);
  });

  it("retires the completed attempt after its subscription ends, permitting a fresh purchase", async () => {
    await checkout(request(), {});
    Object.assign([...sessions.values()][0], { status: "complete", subscription: "sub_ended" });
    Object.assign(db.tables.subscriptions[0], { status: "cancelled", stripe_subscription_id: "sub_ended" });
    subscriptions.push({ id: "sub_ended", status: "canceled" });
    expect((await checkout(request(), {})).status).toBe(200);
    expect(db.tables.subscription_checkout_attempts).toHaveLength(1);
    expect(sessions.size).toBe(2);
  });

  it("expires legacy subscription checkouts without expiring one-time purchases", async () => {
    seedSubscription({ plan: "starter", stripe_subscription_id: null });
    sessions.set("legacy", { id: "cs_legacy", customer: "cus_existing", mode: "subscription", status: "open" });
    sessions.set("call", { id: "cs_call", customer: "cus_existing", mode: "payment", status: "open" });
    expect((await checkout(request(), {})).status).toBe(200);
    expect(sessions.get("legacy")?.status).toBe("expired");
    expect(sessions.get("call")?.status).toBe("open");
  });

  it("does not create a session if a legacy checkout cannot be expired", async () => {
    seedSubscription({ plan: "starter", stripe_subscription_id: null });
    sessions.set("legacy", { id: "cs_legacy", customer: "cus_existing", mode: "subscription", status: "open" });
    vi.mocked(stripe.checkout.sessions.expire).mockRejectedValueOnce(new Error("Legacy checkout completed"));
    expect((await checkout(request(), {})).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rechecks subscriptions when a legacy checkout completes during reconciliation", async () => {
    seedSubscription({ plan: "starter", stripe_subscription_id: null });
    vi.mocked(stripe.checkout.sessions.list).mockImplementationOnce(() => ({
      autoPagingEach: async () => { subscriptions.push({
        id: "sub_raced", customer: "cus_existing", status: "active", metadata: { plan_key: "core" },
        items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
      }); },
    }) as never);
    expect((await checkout(request(), {})).status).toBe(200);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("preserves paid entitlements when initializing an existing customer's association", async () => {
    const row = seedSubscription({ stripe_customer_id: null });
    await ensureBillingCustomer(userId, "cus_new", db.client);
    expect(row).toMatchObject({ plan: "core", feature_tier: "core", stripe_subscription_id: "sub_current", stripe_customer_id: "cus_new" });
  });

  it.each([["core", "payment"], ["cfo_call", "subscription"]])("rejects a mismatched product/mode pair: %s / %s", async (plan, mode) => {
    expect((await checkout(request(plan, mode), {})).status).toBe(400);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("keeps one-time CFO purchases available to current subscribers", async () => {
    seedSubscription();
    expect((await checkout(request("cfo_call", "payment"), {})).status).toBe(200);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ mode: "payment", customer: "cus_existing" }));
  });
});

async function deliver(type: string, object: Row, eventTime = new Date(), eventId = `evt_${++eventSequence}`) {
  if (type === "customer.subscription.updated" && object.id && !subscriptions.some(row => row.id === object.id)) {
    subscriptions.push(object);
  }
  vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
    id: eventId, type, created: Math.floor(eventTime.getTime() / 1000), data: { object: { payment_status: "paid", ...object } },
  } as never);
  return webhook(new NextRequest("https://app.example.invalid/api/stripe/webhook", { method: "POST", body: "synthetic signed event" }));
}

describe("subscription webhook identity", () => {
  it("rejects invalid Stripe signatures before accessing the database", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => { throw new Error("Invalid signature"); });
    const response = await webhook(new NextRequest("https://app.example.invalid/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": "invalid" }, body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
  it("activates the subscription created by the current checkout attempt", async () => {
    await checkout(request(), {});
    const session = [...sessions.values()][0];
    subscriptions.push({
      id: "sub_new", status: "active", customer: session.customer,
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1800000000, current_period_end: 1802592000 }] },
    });
    await deliver("checkout.session.completed", { ...session, subscription: "sub_new", status: "complete" });
    expect(db.tables.subscriptions[0]).toMatchObject({
      stripe_subscription_id: "sub_new", plan: "core", feature_tier: "core", status: "active",
    });
  });

  it("does not activate an already-ended subscription on a delayed checkout event", async () => {
    await checkout(request(), {});
    const session = [...sessions.values()][0];
    subscriptions.push({ id: "sub_new", status: "canceled", customer: session.customer });
    await deliver("checkout.session.completed", { ...session, subscription: "sub_new", status: "complete" });
    expect(db.tables.subscriptions[0].stripe_subscription_id).toBeUndefined();
  });

  it("preserves scheduled cancellation when checkout completion is delivered again", async () => {
    await checkout(request(), {});
    const session = [...sessions.values()][0];
    Object.assign(db.tables.subscriptions[0], { stripe_subscription_id: "sub_new", status: "pending_cancellation" });
    subscriptions.push({ id: "sub_new", status: "active", cancel_at_period_end: true, items: { data: [] } });
    await deliver("checkout.session.completed", { ...session, subscription: "sub_new", status: "complete" });
    expect(db.tables.subscriptions[0].status).toBe("pending_cancellation");
  });

  it.each(["customer.subscription.updated", "customer.subscription.deleted"])("ignores %s from an older subscription", async type => {
    const current = seedSubscription();
    await deliver(type, { id: "sub_old", customer: "cus_existing", status: "canceled", items: { data: [] } });
    expect(current).toMatchObject({ stripe_subscription_id: "sub_current", status: "active", feature_tier: "core" });
    expect(db.writes).toHaveLength(0);
  });

  it("still applies cancellation to the matching subscription", async () => {
    const current = seedSubscription();
    await deliver("customer.subscription.deleted", { id: "sub_current", customer: "cus_existing" });
    expect(current).toMatchObject({ status: "cancelled", feature_tier: "starter" });
    expect(db.writes[0].filters).toContainEqual(["stripe_subscription_id", "sub_current"]);
  });

  it("processes the same Stripe event ID only once", async () => {
    const current = seedSubscription();
    const event = { id: "sub_current", customer: "cus_existing", status: "canceled", items: { data: [] } };
    await deliver("customer.subscription.deleted", event, new Date(), "evt_duplicate");
    await deliver("customer.subscription.deleted", event, new Date(), "evt_duplicate");
    expect(current.status).toBe("cancelled");
    expect(db.tables.stripe_webhook_events).toEqual([expect.objectContaining({
      event_id: "evt_duplicate", status: "completed", attempts: 1,
    })]);
  });

  it("uses current Stripe state when an older subscription update arrives last", async () => {
    const current = seedSubscription({ status: "past_due" });
    subscriptions.push({
      id: "sub_current", customer: "cus_existing", status: "active",
      metadata: { plan_key: "core" }, cancel_at: null, cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
    });
    await deliver("customer.subscription.updated", {
      id: "sub_current", customer: "cus_existing", status: "past_due",
      metadata: { plan_key: "starter" }, items: { data: [] },
    });
    expect(current).toMatchObject({ status: "active", plan: "core", feature_tier: "core", stripe_price_id: "price_core" });
  });

  it("uses the portal-selected price when subscription metadata still names the previous plan", async () => {
    const current = seedSubscription({ plan: "starter", feature_tier: "starter", stripe_price_id: "price_starter" });
    subscriptions.push({
      id: "sub_current", customer: "cus_existing", status: "active",
      metadata: { plan_key: "starter" },
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
    });
    await deliver("customer.subscription.updated", subscriptions[0]);
    expect(current).toMatchObject({ plan: "core", feature_tier: "core", stripe_price_id: "price_core" });
  });

  it("repairs a stale local subscription link before applying a portal upgrade", async () => {
    const current = seedSubscription({
      plan: "starter", feature_tier: "starter", stripe_subscription_id: "sub_ended", stripe_price_id: "price_starter",
    });
    subscriptions.push(
      { id: "sub_ended", customer: "cus_existing", status: "canceled", items: { data: [] } },
      {
        id: "sub_replacement", customer: "cus_existing", status: "active", metadata: { plan_key: "starter" },
        items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: 1795262400 }] },
      },
    );
    await deliver("customer.subscription.updated", subscriptions[1]);
    expect(current).toMatchObject({
      stripe_subscription_id: "sub_replacement", plan: "core", feature_tier: "core", stripe_price_id: "price_core",
    });
  });

  it("does not replace a different active subscription link", async () => {
    const current = seedSubscription({ plan: "starter", feature_tier: "starter" });
    subscriptions.push(
      { id: "sub_current", customer: "cus_existing", status: "active", items: { data: [{ price: { id: "price_starter" } }] } },
      { id: "sub_duplicate", customer: "cus_existing", status: "active", items: { data: [{ price: { id: "price_core" } }] } },
    );
    await deliver("customer.subscription.updated", subscriptions[1]);
    expect(current).toMatchObject({ stripe_subscription_id: "sub_current", plan: "starter", feature_tier: "starter" });
  });

  it("does not roll back committed billing state when email delivery fails", async () => {
    const current = seedSubscription();
    subscriptions.push({ id: "sub_current", customer: "cus_existing", status: "past_due", items: { data: [] } });
    vi.mocked(sendPaymentFailedEmail).mockRejectedValueOnce(new Error("Email provider unavailable"));
    const response = await deliver("invoice.payment_failed", {
      customer: "cus_existing", parent: { subscription_details: { subscription: "sub_current" } },
    });
    expect(response.status).toBe(200);
    expect(current.status).toBe("past_due");
    expect(db.tables.stripe_webhook_events[0]).toMatchObject({ status: "completed" });
  });

  it.each(["invoice.payment_failed", "invoice.payment_succeeded"])("ignores %s for an old subscription or a one-time purchase", async type => {
    const current = seedSubscription({ status: "past_due" });
    await deliver(type, { customer: "cus_existing", parent: { subscription_details: { subscription: "sub_old" } } });
    await deliver(type, { customer: "cus_existing", parent: null });
    expect(current.status).toBe("past_due");
    expect(db.writes).toHaveLength(0);
    expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it("applies payment failure to the matching subscription", async () => {
    const current = seedSubscription();
    subscriptions.push({ id: "sub_current", customer: "cus_existing", status: "past_due", items: { data: [] } });
    await deliver("invoice.payment_failed", { customer: "cus_existing", parent: { subscription_details: { subscription: "sub_current" } } });
    expect(current.status).toBe("past_due");
    expect(sendPaymentFailedEmail).toHaveBeenCalledOnce();
  });

  it("applies payment success with an expanded matching subscription ID", async () => {
    const current = seedSubscription({ status: "past_due" });
    subscriptions.push({ id: "sub_current", status: "active", items: { data: [] } });
    await deliver("invoice.payment_succeeded", {
      customer: "cus_existing", parent: { subscription_details: { subscription: { id: "sub_current" } } },
    });
    expect(current.status).toBe("active");
    expect(db.writes[0].filters).toContainEqual(["stripe_subscription_id", "sub_current"]);
  });

  it("ignores a superseded checkout completion", async () => {
    const current = seedSubscription();
    await deliver("checkout.session.completed", {
      mode: "subscription", subscription: "sub_old", customer: "cus_existing",
      metadata: { supabase_user_id: userId, plan_key: "core", checkout_attempt_id: "old_attempt" },
    });
    expect(current.stripe_subscription_id).toBe("sub_current");
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("ignores a legacy completion targeting a different subscription", async () => {
    seedSubscription();
    await deliver("checkout.session.completed", {
      mode: "subscription", subscription: "sub_old",
      metadata: { supabase_user_id: userId, plan_key: "core" },
    });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

function cancelledFoundingMember(overrides: Row = {}) {
  return seedSubscription({
    plan: "founding_member", feature_tier: "suspended", status: "cancelled",
    stripe_subscription_id: "sub_ended", founding_member_number: 7,
    billing_period_end: "2026-10-01T12:00:00.000Z",
    founding_member_cancelled_at: "2026-10-01T12:00:00.000Z",
    founding_member_grace_ends_at: "2026-10-31T12:00:00.000Z",
    founding_member_rate_lost_at: null, ...overrides,
  });
}

async function restorationPayment() {
  const response = await checkout(request("founding_member"), {});
  expect(response.status).toBe(200);
  const session = [...sessions.values()].find(row => row.status === "open")!;
  subscriptions.push({
    id: "sub_restored", customer: session.customer, status: "active", latest_invoice: "in_restore",
    items: { data: [{ price: { id: "price_founding" }, current_period_start: 1800000000, current_period_end: 1802592000 }] },
  });
  invoicePayments.push({ id: "ip_restore", amount_paid: 4900, payment: { payment_intent: "pi_restore" } });
  return { ...session, status: "complete", subscription: "sub_restored" };
}

function legacyRestorationPayment(supportApproved = false) {
  db.tables.subscription_checkout_attempts.push({ user_id: userId, id: "legacy_attempt" });
  subscriptions.push({
    id: "sub_restored", customer: "cus_existing", status: "active", latest_invoice: "in_restore",
    items: { data: [{ price: { id: "price_founding" }, current_period_start: 1800000000, current_period_end: 1802592000 }] },
  });
  invoicePayments.push({ id: "ip_restore", amount_paid: 4900, payment: { payment_intent: "pi_restore" } });
  return {
    id: "cs_legacy", mode: "subscription", customer: "cus_existing", status: "complete", subscription: "sub_restored",
    metadata: { supabase_user_id: userId, plan_key: "founding_member",
      ...(supportApproved ? { founding_reinstatement: "support" } : { checkout_attempt_id: "legacy_attempt", restoration_deadline: "2026-10-31T12:00:00Z" }),
    },
  };
}

describe("Founding Member billing-cycle reinstatement policy", () => {
  it.each(["2026-10-22T11:59:59.999Z", "2026-10-01T12:00:00Z", "2026-08-01T12:00:00Z"])("requires support after effective end, even with legacy future grace dates: %s", async end => {
    cancelledFoundingMember({ billing_period_end: end, founding_member_cancelled_at: end });
    const response = await checkout(request("founding_member"), {});
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("case by case");
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(getFoundingMemberAvailability).not.toHaveBeenCalled();
    expect(db.tables.subscription_checkout_attempts).toHaveLength(0);
    expect(db.tables.subscriptions[0].founding_member_number).toBe(7);
  });

  it.each(["starter", "core"])("lets a cancelled holder choose standard %s pricing and keeps their number", async plan => {
    const row = cancelledFoundingMember();
    const response = await checkout(request(plan), {});
    expect(response.status).toBe(200);
    expect([...sessions.values()][0]).toMatchObject({
      line_items: [{ price: `price_${plan}`, quantity: 1 }],
      metadata: { plan_key: plan },
    });
    expect(row.founding_member_number).toBe(7);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("does not change a former holder's active standard plan into a Founding plan", async () => {
    cancelledFoundingMember({ plan: "starter", status: "active", stripe_subscription_id: "sub_starter" });
    expect((await checkout(request("founding_member"), {})).status).toBe(409);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("reverses obsolete self-service price changes without granting Core", async () => {
    const row = cancelledFoundingMember({ plan: "starter", status: "active", feature_tier: "starter", stripe_subscription_id: "sub_starter", stripe_price_id: "price_starter" });
    await deliver("customer.subscription.updated", {
      id: "sub_starter", customer: "cus_existing", status: "active",
      metadata: { plan_key: "founding_member", founding_restore_deadline: "2026-10-31T12:00:00.000Z" },
      items: { data: [{ id: "si_starter", price: { id: "price_founding" } }] },
    });
    expect(row).toMatchObject({ plan: "starter", feature_tier: "starter", founding_member_number: 7 });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_starter", expect.objectContaining({
      items: [{ id: "si_starter", price: "price_starter" }], proration_behavior: "none",
    }), expect.anything());
  });

  it("ignores a client-supplied deadline and member number", async () => {
    cancelledFoundingMember({ founding_member_cancelled_at: "2026-08-01T00:00:00Z" });
    const response = await checkout(new NextRequest("https://app.example.invalid/api/stripe/checkout", {
      method: "POST", body: JSON.stringify({ planKey: "founding_member", mode: "subscription", memberNumber: 99, restorationDeadline: "2099-01-01", founding_reinstatement: "support" }),
    }), {});
    expect(response.status).toBe(409);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("restores the original number only on a support-approved Stripe checkout", async () => {
    const row = cancelledFoundingMember();
    const session = legacyRestorationPayment(true);
    expect((await deliver("checkout.session.completed", session)).status).toBe(200);
    expect(db.tables.subscriptions).toHaveLength(1);
    expect(row).toMatchObject({
      stripe_subscription_id: "sub_restored", founding_member_number: 7,
      plan: "founding_member", feature_tier: "core", status: "active",
      founding_member_cancelled_at: null, founding_member_grace_ends_at: null,
    });
    expect(upsertNewFoundingMember).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("cancels and refunds an obsolete self-service checkout instead of granting Core or a new spot", async () => {
    const row = cancelledFoundingMember();
    const session = legacyRestorationPayment();
    expect((await deliver("checkout.session.completed", session)).status).toBe(200);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_restored", expect.anything(), expect.anything());
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_restore", amount: 4900 }, {
      idempotencyKey: "ineligible-founding-refund:ip_restore",
    });
    expect(row).toMatchObject({ stripe_subscription_id: "sub_ended", founding_member_number: 7, feature_tier: "suspended", status: "cancelled" });
    expect(row.founding_member_rate_lost_at).toBeNull();
    expect(upsertNewFoundingMember).not.toHaveBeenCalled();
  });

  it("returns 500 and retries reversal safely if the refund temporarily fails", async () => {
    const row = cancelledFoundingMember();
    const session = legacyRestorationPayment();
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(new Error("Temporary Stripe error"));
    expect((await deliver("checkout.session.completed", session)).status).toBe(500);
    expect((await deliver("checkout.session.completed", session)).status).toBe(200);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledOnce();
    expect(row.feature_tier).toBe("suspended");
    const keys = vi.mocked(stripe.refunds.create).mock.calls.map(call => call[1]?.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("does not grant benefits on an unpaid restoration checkout", async () => {
    const row = cancelledFoundingMember();
    const session = legacyRestorationPayment();
    await deliver("checkout.session.completed", { ...session, payment_status: "unpaid" });
    expect(row.feature_tier).toBe("suspended");
    expect(row.stripe_subscription_id).toBe("sub_ended");
  });

  it("preserves the effective end and number without starting a grace clock on repeated cancellation events", async () => {
    const row = seedSubscription({ plan: "founding_member", founding_member_number: 7 });
    const endedAt = Math.floor(new Date("2026-10-10T12:00:00Z").getTime() / 1000);
    const event = { id: "sub_current", customer: "cus_existing", ended_at: endedAt };
    await deliver("customer.subscription.deleted", event);
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    await deliver("customer.subscription.deleted", event);
    expect(row).toMatchObject({
      founding_member_number: 7, feature_tier: "suspended", status: "cancelled",
      founding_member_cancelled_at: "2026-10-10T12:00:00.000Z", founding_member_grace_ends_at: null,
    });
  });

  it("keeps access until scheduled billing end, then suspends without an automatic restoration window", async () => {
    const row = seedSubscription({ plan: "founding_member", founding_member_number: 7 });
    await deliver("customer.subscription.updated", {
      id: "sub_current", customer: "cus_existing", status: "active", cancel_at_period_end: true,
      items: { data: [{ current_period_end: Math.floor(new Date("2026-11-01T12:00:00Z").getTime() / 1000) }] },
    });
    expect(row.status).toBe("pending_cancellation");
    expect(row.founding_member_cancelled_at).toBeUndefined();
    const endedAt = Math.floor(new Date("2026-11-01T12:00:00Z").getTime() / 1000);
    await deliver("customer.subscription.deleted", { id: "sub_current", customer: "cus_existing", ended_at: endedAt });
    expect(row.founding_member_grace_ends_at).toBeNull();
    expect(row.founding_member_number).toBe(7);
    expect(row.feature_tier).toBe("suspended");
  });

  it("uses event time, not delayed processing time, when ended_at is unavailable", async () => {
    const row = seedSubscription({ plan: "founding_member", founding_member_number: 7 });
    await deliver("customer.subscription.deleted", { id: "sub_current", customer: "cus_existing" }, new Date("2026-10-10T12:00:00Z"));
    expect(row.founding_member_cancelled_at).toBe("2026-10-10T12:00:00.000Z");
  });

  it("does not revive a cancelled subscription from a late invoice or subscription update", async () => {
    const row = cancelledFoundingMember();
    await deliver("invoice.payment_succeeded", { customer: "cus_existing", parent: { subscription_details: { subscription: "sub_ended" } } });
    await deliver("customer.subscription.updated", { id: "sub_ended", customer: "cus_existing", status: "active" });
    expect(row.status).toBe("cancelled");
    expect(row.feature_tier).toBe("suspended");
  });

  it("reverses payment if the last new spot was consumed by a concurrent purchase", async () => {
    vi.mocked(upsertNewFoundingMember).mockResolvedValueOnce({ upsertError: { code: "P0002" }, memberNumber: null });
    const session = await restorationPayment();
    await deliver("checkout.session.completed", session);
    expect(stripe.refunds.create).toHaveBeenCalledOnce();
    expect(db.tables.subscriptions[0].feature_tier).toBe("starter");
    expect(db.tables.subscriptions[0].founding_member_number).toBeUndefined();
  });
});

describe("keeping a scheduled membership", () => {
  it.each([
    ["2026-10-22T11:59:59.999Z", 409],
    ["2026-10-22T12:00:00.000Z", 409],
    ["2026-10-22T12:00:00.001Z", 200],
    [null, 409], ["invalid", 409],
  ])("enforces the stored paid-cycle cutoff (%s)", async (end, expected) => {
    const row = seedSubscription({ plan: "founding_member", status: "pending_cancellation", founding_member_number: 7, billing_period_end: end });
    subscriptions.push({ id: "sub_current", status: "active", cancel_at: 1793534400, items: { data: [] } });
    const response = await reactivate(new NextRequest("https://app.example.invalid/api/stripe/reactivate", { method: "POST" }), {});
    expect(response.status).toBe(expected);
    expect(row.founding_member_number).toBe(7);
    if (expected === 409) {
      expect(row.status).toBe("pending_cancellation");
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    } else {
      expect(row.status).toBe("active");
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    }
  });

  it("also enforces Stripe's effective cancellation time when the database is stale", async () => {
    seedSubscription({ plan: "founding_member", status: "pending_cancellation", billing_period_end: "2026-11-01T12:00:00Z" });
    subscriptions.push({ id: "sub_current", status: "active", cancel_at: Date.now() / 1000, items: { data: [] } });
    expect((await reactivate(new NextRequest("https://app.example.invalid/api/stripe/reactivate", { method: "POST" }), {})).status).toBe(409);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it.each([true, false])("clears the correct Stripe scheduling mechanism (cancel_at: %s)", async usesDate => {
    seedSubscription({ plan: "founding_member", status: "pending_cancellation", billing_period_end: "2026-11-01T12:00:00Z" });
    subscriptions.push({ id: "sub_current", status: "active", cancel_at: usesDate ? 1793534400 : null, cancel_at_period_end: !usesDate, items: { data: [{ current_period_end: 1793534400 }] } });
    const response = await reactivate(new NextRequest("https://app.example.invalid/api/stripe/reactivate", { method: "POST" }), {});
    expect(response.status).toBe(200);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_current", usesDate ? { cancel_at: null } : { cancel_at_period_end: false });
  });

  it("cannot revive a fully ended Stripe subscription by merely changing database status", async () => {
    const row = seedSubscription({ plan: "founding_member", status: "pending_cancellation", billing_period_end: "2026-11-01T12:00:00Z" });
    subscriptions.push({ id: "sub_current", status: "canceled" });
    const response = await reactivate(new NextRequest("https://app.example.invalid/api/stripe/reactivate", { method: "POST" }), {});
    expect(response.status).toBe(409);
    expect(row.status).toBe("pending_cancellation");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});


describe("webhook subscription status compatibility", () => {
  const statuses = [
    ["active", "active"], ["trialing", "trialing"], ["past_due", "past_due"],
    ["unpaid", "past_due"], ["incomplete", "past_due"], ["paused", "paused"],
  ] as const;
  const periodEnd = Math.floor(new Date("2026-11-01T12:00:00Z").getTime() / 1000);
  function snapshot(status: string, overrides: Row = {}): Row {
    return {
      id: "sub_current", customer: "cus_existing", status,
      cancel_at: null, cancel_at_period_end: false, metadata: { plan_key: "core" },
      items: { data: [{ price: { id: "price_core" }, current_period_start: 1792584000, current_period_end: periodEnd }] },
      ...overrides,
    };
  }
  function invoice() {
    return { customer: "cus_existing", parent: { subscription_details: { subscription: "sub_current" } } };
  }

  it.each(statuses)("persists Stripe %s as CHECK-compatible %s on updates", async (status, expected) => {
    const row = seedSubscription();
    expect((await deliver("customer.subscription.updated", snapshot(status))).status).toBe(200);
    expect(row.status).toBe(expected);
  });

  it.each(statuses)("persists a paid checkout with current Stripe status %s as %s", async (status, expected) => {
    await checkout(request(), {});
    const session = [...sessions.values()][0];
    subscriptions.push(snapshot(status, { id: "sub_new", customer: session.customer }));
    expect((await deliver("checkout.session.completed", { ...session, subscription: "sub_new" })).status).toBe(200);
    expect(db.tables.subscriptions[0].status).toBe(expected);
    expect(db.tables.subscriptions[0].stripe_subscription_id).toBe("sub_new");
  });

  it.each(["canceled", "incomplete_expired"])("runs terminal cleanup for %s updates even if cancellation flags remain", async status => {
    const row = seedSubscription({ plan: "founding_member", status: "pending_cancellation", founding_member_number: 26, founding_member_is_test: true });
    const terminal = snapshot(status, { ended_at: 1792670400, cancel_at: periodEnd, cancel_at_period_end: true });
    expect((await deliver("customer.subscription.updated", terminal)).status).toBe(200);
    expect(row).toMatchObject({ plan: "founding_member", status: "cancelled", feature_tier: "suspended", founding_member_number: 26, founding_member_is_test: true });
    expect(row.cancelled_at).toBe("2026-10-22T12:00:00.000Z");
    expect(row.billing_period_end).toBe(row.cancelled_at);
    expect(row.founding_member_cancelled_at).toBe(row.cancelled_at);
    expect(row.founding_member_grace_ends_at).toBeNull();
    expect((await deliver("customer.subscription.deleted", terminal)).status).toBe(200);
    expect(sendFoundingMemberCancelledEmail).not.toHaveBeenCalled(); // scheduled notice already sent
  });

  it("does not turn a pending cancellation active when Stripe clears its flags on termination", async () => {
    const row = seedSubscription({ status: "pending_cancellation", plan: "founding_member", founding_member_number: 7 });
    expect((await deliver("customer.subscription.updated", snapshot("canceled", { ended_at: 1792670400 }))).status).toBe(200);
    expect(row.status).toBe("cancelled");
    expect(row.feature_tier).toBe("suspended");
  });

  it.each(["unpaid", "past_due", "paused", "incomplete", "trialing"])("never promotes %s to paid pending_cancellation just because a cancellation is scheduled", async status => {
    const row = seedSubscription({ status: "pending_cancellation" });
    await deliver("customer.subscription.updated", snapshot(status, { cancel_at: periodEnd }));
    expect(row.status).toBe(status === "unpaid" || status === "incomplete" ? "past_due" : status);
    expect(sendFoundingMemberCancelledEmail).not.toHaveBeenCalled();
  });

  it.each(["invoice.payment_failed", "invoice.payment_succeeded"])("keeps an active scheduled cancellation for %s using current Stripe state", async type => {
    const row = seedSubscription({ status: "pending_cancellation" });
    subscriptions.push(snapshot("active", { cancel_at: periodEnd }));
    expect((await deliver(type, invoice())).status).toBe(200);
    expect(row.status).toBe("pending_cancellation");
    expect(row.billing_period_end).toBe("2026-11-01T12:00:00.000Z");
    expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it.each(["unpaid", "incomplete", "past_due", "paused", "trialing"])("does not grant active access on a late paid invoice while Stripe is %s", async status => {
    const row = seedSubscription({ status: "past_due" });
    subscriptions.push(snapshot(status));
    expect((await deliver("invoice.payment_succeeded", invoice())).status).toBe(200);
    expect(row.status).toBe(status === "unpaid" || status === "incomplete" ? "past_due" : status);
  });

  it("ignores the payment-failure state of an old invoice after the subscription recovered", async () => {
    const row = seedSubscription();
    subscriptions.push(snapshot("active"));
    await deliver("invoice.payment_failed", invoice());
    expect(row.status).toBe("active");
    expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it.each(["invoice.payment_failed", "invoice.payment_succeeded"])("applies terminal cleanup from current Stripe state on %s", async type => {
    const row = seedSubscription({ plan: "founding_member", founding_member_number: 7 });
    subscriptions.push(snapshot("canceled", { ended_at: 1792670400 }));
    expect((await deliver(type, invoice())).status).toBe(200);
    expect(row).toMatchObject({ plan: "founding_member", status: "cancelled", feature_tier: "suspended", founding_member_number: 7 });
    expect(row.founding_member_cancelled_at).toBe("2026-10-22T12:00:00.000Z");
    expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it("preserves a former Founder's identity when their standard plan ends", async () => {
    const row = seedSubscription({ plan: "core", founding_member_number: 7 });
    await deliver("customer.subscription.updated", snapshot("canceled", { ended_at: 1792670400 }));
    expect(row).toMatchObject({ plan: "starter", feature_tier: "starter", status: "cancelled", founding_member_number: 7 });
    expect(row.cancelled_at).toBe("2026-10-22T12:00:00.000Z");
  });

  it("sends an immediate cancellation notice once across updated/deleted delivery order", async () => {
    seedSubscription({ plan: "founding_member", founding_member_number: 7 });
    const terminal = snapshot("canceled", { ended_at: 1792670400 });
    await deliver("customer.subscription.updated", terminal);
    await deliver("customer.subscription.deleted", terminal);
    expect(sendFoundingMemberCancelledEmail).toHaveBeenCalledOnce();
  });

  it.each(["invoice.payment_failed", "invoice.payment_succeeded"])("returns 500 without granting access when Stripe lookup fails on %s", async type => {
    const row = seedSubscription({ status: "past_due" });
    vi.mocked(stripe.subscriptions.retrieve).mockRejectedValueOnce(new Error("Stripe temporarily unavailable"));
    expect((await deliver(type, invoice())).status).toBe(500);
    expect(row.status).toBe("past_due");
    expect(db.writes).toHaveLength(0);
  });

  it("rejects unknown future Stripe states without writing an unsupported database value", async () => {
    const row = seedSubscription();
    expect((await deliver("customer.subscription.updated", snapshot("future_status"))).status).toBe(500);
    expect(row.status).toBe("active");
    expect(db.writes).toHaveLength(0);
  });

  it.each(["cancellation", "replacement"])("does not overwrite a concurrent %s during invoice reconciliation", async change => {
    const row = seedSubscription({ status: "past_due" });
    db.tables.usage_tracking.push({ user_id: userId, period_end: "2026-09-01T00:00:00Z" });
    vi.mocked(stripe.subscriptions.retrieve).mockImplementationOnce(async () => {
      Object.assign(row, change === "cancellation"
        ? { status: "cancelled", feature_tier: "suspended" }
        : { status: "active", stripe_subscription_id: "sub_replacement" });
      return snapshot("active") as never;
    });
    expect((await deliver("invoice.payment_succeeded", invoice())).status).toBe(200);
    if (change === "cancellation") expect(row.status).toBe("cancelled");
    else expect(row.stripe_subscription_id).toBe("sub_replacement");
    expect(db.tables.usage_tracking).toHaveLength(1);
  });

  it("does not reuse a historical Founding cancellation date when a later standard plan ends", async () => {
    const row = seedSubscription({ founding_member_number: 7, founding_member_cancelled_at: "2026-08-01T00:00:00Z" });
    const eventTime = new Date("2026-10-21T12:00:00Z");
    await deliver("customer.subscription.deleted", snapshot("canceled"), eventTime);
    expect(row.cancelled_at).toBe(eventTime.toISOString());
    expect(row.founding_member_cancelled_at).toBe("2026-08-01T00:00:00Z");
    expect(row.founding_member_number).toBe(7);
  });
});
