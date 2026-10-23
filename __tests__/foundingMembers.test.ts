import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/service", () => ({ createServiceClient: vi.fn() }));

import {
  getFoundingMemberAvailability,
  upsertNewFoundingMember,
} from "../lib/foundingMembers";
import { FOUNDING_MEMBER_SPOTS } from "../lib/launchConfig";
import { createServiceClient } from "../utils/supabase/service";
import { GET, OPTIONS } from "../app/api/public/founding-spots/route";

// Minimal query-builder stub recording how the count query is built.
function mockClient(result: { count: number | null; error: unknown }) {
  const calls: { select?: unknown[]; eq?: unknown[]; table?: string } = {};
  const builder = {
    select: (...args: unknown[]) => {
      calls.select = args;
      return builder;
    },
    eq: (...args: unknown[]) => {
      calls.eq = args;
      return Promise.resolve(result);
    },
  };
  const client = { from: (table: string) => { calls.table = table; return builder; } } as unknown as SupabaseClient;
  return { client, calls };
}

function req(origin?: string) {
  return new NextRequest("https://app.elidan.ai/api/public/founding-spots", {
    headers: origin ? { origin } : {},
  });
}

describe("getFoundingMemberAvailability", () => {
  it("counts only customer spots, head-only (no row data)", async () => {
    const { client, calls } = mockClient({ count: 1, error: null });
    await getFoundingMemberAvailability(client);
    expect(calls.select).toEqual(["founding_member_number", { count: "exact", head: true }]);
    expect(calls.eq).toEqual(["is_test", false]);
    expect(calls.table).toBe("founding_member_spots");
  });

  it("total comes from FOUNDING_MEMBER_SPOTS", async () => {
    const { client } = mockClient({ count: 21, error: null });
    expect(await getFoundingMemberAvailability(client)).toEqual({
      total: FOUNDING_MEMBER_SPOTS,
      claimed: 21,
      remaining: FOUNDING_MEMBER_SPOTS - 21,
      soldOut: false,
    });
  });

  it("claimed == cap → remaining 0, soldOut", async () => {
    const { client } = mockClient({ count: FOUNDING_MEMBER_SPOTS, error: null });
    const r = await getFoundingMemberAvailability(client);
    expect(r.remaining).toBe(0);
    expect(r.soldOut).toBe(true);
  });

  it("claimed > cap → remaining clamps to 0", async () => {
    const { client } = mockClient({ count: FOUNDING_MEMBER_SPOTS + 3, error: null });
    const r = await getFoundingMemberAvailability(client);
    expect(r.remaining).toBe(0);
    expect(r.soldOut).toBe(true);
  });

  it("throws on query error rather than defaulting", async () => {
    const { client } = mockClient({ count: null, error: new Error("boom") });
    await expect(getFoundingMemberAvailability(client)).rejects.toThrow("boom");
  });

  it("excludes explicitly designated test memberships from the public capacity", async () => {
    const spots = [{ is_test: false }, { is_test: true }, { is_test: true }];
    const client = { from: () => ({ select: () => ({
      eq: (column: string, value: boolean) => {
        expect(column).toBe("is_test");
        return Promise.resolve({ count: spots.filter(spot => spot.is_test === value).length, error: null });
      },
    }) }) } as unknown as SupabaseClient;
    expect(await getFoundingMemberAvailability(client)).toMatchObject({ claimed: 1, remaining: 24, soldOut: false });
  });
});

describe("GET /api/public/founding-spots", () => {
  beforeEach(() => {
    vi.mocked(createServiceClient).mockReset();
  });

  it("returns only the public fields with cache headers", async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      mockClient({ count: 21, error: null }).client
    );
    const res = await GET(req("https://elidan.ai"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["claimed", "remaining", "soldOut", "total", "updatedAt"]
    );
    expect(body).toMatchObject({ total: FOUNDING_MEMBER_SPOTS, claimed: 21, soldOut: false });
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("echoes allowed origins, never * or a foreign origin", async () => {
    vi.mocked(createServiceClient).mockImplementation(
      () => mockClient({ count: 1, error: null }).client
    );
    const www = await GET(req("https://www.elidan.ai"));
    expect(www.headers.get("access-control-allow-origin")).toBe("https://www.elidan.ai");
    const apex = await GET(req("https://elidan.ai"));
    expect(apex.headers.get("access-control-allow-origin")).toBe("https://elidan.ai");
    const evil = await GET(req("https://evil.example"));
    expect(evil.headers.get("access-control-allow-origin")).toBe("https://elidan.ai");
  });

  it("returns 503 no-store and no count on error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createServiceClient).mockReturnValue(
      mockClient({ count: null, error: new Error("db down") }).client
    );
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("OPTIONS preflight → 204 with allowed methods", async () => {
    const res = OPTIONS(req("https://elidan.ai"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://elidan.ai");
  });
});

// Stub supporting customer-identity lookups and upserts.
function numberingClient(opts: {
  issuedNumbers: number[][]; // customer numbers returned on each successive lookup
  upsertErrors: ({ code: string } | null)[]; // result of each successive upsert
  queryError?: Error;
}) {
  const upserts: Record<string, unknown>[] = [];
  let issuedCall = 0;
  let upsertCall = 0;
  const builder = {
    head: false,
    select(_cols: string, o?: { head?: boolean }) {
      builder.head = !!o?.head;
      return builder;
    },
    eq(_key: string, value: boolean) {
      expect(_key).toBe("is_test");
      expect(value).toBe(false);
      if (opts.queryError) return Promise.resolve({ data: null, error: opts.queryError });
      const numbers = opts.issuedNumbers[Math.min(issuedCall++, opts.issuedNumbers.length - 1)];
      return Promise.resolve({ data: numbers.map(founding_member_number => ({ founding_member_number })), error: null });
    },
    upsert: (payload: Record<string, unknown>) => {
      upserts.push(payload);
      return Promise.resolve({ error: opts.upsertErrors[upsertCall++] ?? null });
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, upserts };
}

describe("upsertNewFoundingMember", () => {
  const row = { user_id: "u1", plan: "founding_member" };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("assigns the lowest available customer number, including a released test claim", async () => {
    const { client, upserts } = numberingClient({ issuedNumbers: [[2]], upsertErrors: [null] });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: null, memberNumber: 1 });
    expect(upserts[0].founding_member_number).toBe(1);
  });

  it("first member gets #1", async () => {
    const { client } = numberingClient({ issuedNumbers: [[]], upsertErrors: [null] });
    expect((await upsertNewFoundingMember(row, "u1", client)).memberNumber).toBe(1);
  });

  it("never issues a new membership when all permanent spots have been consumed", async () => {
    const { client, upserts } = numberingClient({ issuedNumbers: [Array.from({ length: 25 }, (_, i) => i + 1)], upsertErrors: [] });
    expect(await upsertNewFoundingMember(row, "u1", client)).toEqual({ upsertError: { code: "P0002" }, memberNumber: null });
    expect(upserts).toHaveLength(0);
  });

  it("retries with a fresh number on unique violation", async () => {
    const { client, upserts } = numberingClient({
      issuedNumbers: [[1, 2, 3, 4], [1, 2, 3, 4, 5]],
      upsertErrors: [{ code: "23505" }, null],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: null, memberNumber: 6 });
    expect(upserts.map((u) => u.founding_member_number)).toEqual([5, 6]);
  });

  it("after repeated conflicts, requests a retry without granting an untracked membership", async () => {
    const { client, upserts } = numberingClient({
      issuedNumbers: [[1, 2, 3, 4]],
      upsertErrors: [{ code: "23505" }, { code: "23505" }, { code: "23505" }, null],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: { code: "40001" }, memberNumber: null });
    expect(upserts).toHaveLength(3);
    expect(upserts.every(row => row.founding_member_number != null)).toBe(true);
  });

  it("does not retry on non-conflict errors", async () => {
    const { client, upserts } = numberingClient({
      issuedNumbers: [[]],
      upsertErrors: [{ code: "42501" }],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: { code: "42501" }, memberNumber: null });
    expect(upserts).toHaveLength(1);
  });

  it("ignores high test numbers and never allocates a customer number above 25", async () => {
    const { client } = numberingClient({ issuedNumbers: [[26, 1000, ...Array.from({ length: 24 }, (_, i) => i + 1)]], upsertErrors: [null] });
    expect((await upsertNewFoundingMember(row, "u1", client)).memberNumber).toBe(25);
  });

  it("never grants membership when the issued-identity query fails", async () => {
    const { client, upserts } = numberingClient({ issuedNumbers: [[]], upsertErrors: [], queryError: new Error("Unavailable") });
    expect(await upsertNewFoundingMember(row, "u1", client)).toEqual({ upsertError: { code: "40001" }, memberNumber: null });
    expect(upserts).toHaveLength(0);
  });
});
