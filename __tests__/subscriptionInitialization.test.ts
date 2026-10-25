import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
import { getSubscription } from "../lib/db";

type Row = Record<string, unknown>;
const userId = "own-user";
function subscription(overrides: Row = {}): Row {
  return {
    user_id: userId, plan: "starter", feature_tier: "starter", status: "active",
    billing_period_end: null, founding_member_expires_at: null,
    founding_member_number: null, founding_member_is_test: false,
    founding_member_cancelled_at: null, founding_member_grace_ends_at: null,
    ...overrides,
  };
}

// Model both PostgreSQL conflict behaviors and a webhook arriving between
// the initial read and default insertion. This never connects to Supabase.
function database(options: {
  concurrentRow?: Row;
  writeError?: Error;
  readErrorAt?: number;
  hideReadAt?: number;
} = {}) {
  const rows = new Map<string, Row>();
  let reads = 0;
  const initialize = vi.fn(async () => {
    if (options.writeError) return { error: options.writeError };
    if (options.concurrentRow) rows.set(userId, { ...options.concurrentRow });
    if (!rows.has(userId)) rows.set(userId, subscription());
    return { error: null };
  });
  const client = {
    rpc(name: string) {
      expect(name).toBe("initialize_subscription");
      return initialize();
    },
    from(table: string) {
      expect(table).toBe("subscriptions");
      let filter: string;
      let columns: string;
      const query = {
        select(value: string) { columns = value; return query; },
        eq(key: string, value: string) { expect(key).toBe("user_id"); filter = value; return query; },
        async maybeSingle() {
          reads++;
          if (reads === options.readErrorAt) return { data: null, error: new Error("Read failed") };
          const row = reads === options.hideReadAt ? undefined : rows.get(filter);
          const data = row ? Object.fromEntries(columns.split(", ").map(key => [key, row[key]])) : null;
          return { data, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { rows, initialize, client };
}

describe("subscription default initialization", () => {
  it("persists and returns a new account's Starter subscription", async () => {
    const db = database();
    expect(await getSubscription(userId, db.client)).toMatchObject({ plan: "starter", status: "active", founding_member_number: null });
    expect(db.rows.get(userId)).toMatchObject({ user_id: userId, plan: "starter" });
    expect(db.initialize).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    { plan: "core", feature_tier: "core", status: "active" },
    { plan: "founding_member", feature_tier: "core", status: "pending_cancellation", founding_member_number: 26, founding_member_is_test: true },
    { plan: "founding_member", feature_tier: "suspended", status: "cancelled", founding_member_number: 1, founding_member_cancelled_at: "2026-10-23T00:00:00Z" },
  ])("preserves and returns a concurrent $plan / $status row", async overrides => {
    const paid = subscription({ ...overrides, stripe_customer_id: "cus_test", stripe_subscription_id: "sub_test", billing_period_end: "2026-11-23T00:00:00Z" });
    const db = database({ concurrentRow: paid });
    const result = await getSubscription(userId, db.client);
    expect(db.initialize).toHaveBeenCalledExactlyOnceWith();
    expect(db.rows.get(userId)).toEqual(paid);
    expect(result).toMatchObject(overrides);
    expect(result.billing_period_end).toBe(paid.billing_period_end);
  });

  it("returns an existing subscription without attempting initialization", async () => {
    const db = database();
    db.rows.set(userId, subscription({ plan: "core", feature_tier: "core" }));
    expect(await getSubscription(userId, db.client)).toMatchObject({ plan: "core", feature_tier: "core" });
    expect(db.initialize).not.toHaveBeenCalled();
  });

  it("keeps reads and initialization scoped to the requested account", async () => {
    const db = database();
    const other = subscription({ user_id: "other-user", plan: "core" });
    db.rows.set("other-user", other);
    expect(await getSubscription(userId, db.client)).toMatchObject({ plan: "starter" });
    expect(db.rows.get("other-user")).toEqual(other);
    expect(db.rows.get(userId)?.user_id).toBe(userId);
  });

  it("supports two requests initializing the same account", async () => {
    const db = database();
    const results = await Promise.all([getSubscription(userId, db.client), getSubscription(userId, db.client)]);
    expect(db.rows.size).toBe(1);
    expect(results[0]).toEqual(results[1]);
  });

  it("propagates initialization errors instead of returning invented access", async () => {
    const failure = new Error("Insert denied");
    const db = database({ writeError: failure });
    await expect(getSubscription(userId, db.client)).rejects.toBe(failure);
    expect(db.rows.size).toBe(0);
  });

  it.each([1, 2])("propagates a failure on read %s", async readErrorAt => {
    const db = database({ readErrorAt });
    await expect(getSubscription(userId, db.client)).rejects.toThrow("Read failed");
    if (readErrorAt === 1) expect(db.initialize).not.toHaveBeenCalled();
  });

  it("fails if the initialized subscription cannot be read back", async () => {
    const db = database({ hideReadAt: 2 });
    await expect(getSubscription(userId, db.client)).rejects.toThrow();
  });
});
