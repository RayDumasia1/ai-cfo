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
  const calls: { select?: unknown[]; not?: unknown[] } = {};
  const builder = {
    select: (...args: unknown[]) => {
      calls.select = args;
      return builder;
    },
    not: (...args: unknown[]) => {
      calls.not = args;
      return Promise.resolve(result);
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, calls };
}

function req(origin?: string) {
  return new NextRequest("https://app.elidan.ai/api/public/founding-spots", {
    headers: origin ? { origin } : {},
  });
}

describe("getFoundingMemberAvailability", () => {
  it("counts rows with a member number, head-only (no row data)", async () => {
    const { client, calls } = mockClient({ count: 1, error: null });
    await getFoundingMemberAvailability(client);
    expect(calls.select).toEqual(["id", { count: "exact", head: true }]);
    expect(calls.not).toEqual(["founding_member_number", "is", null]);
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

// Stub supporting the count query, the max-number query, and upserts.
function numberingClient(opts: {
  claimed: number;
  maxNumbers: number[]; // max number returned on each successive lookup
  upsertErrors: ({ code: string } | null)[]; // result of each successive upsert
}) {
  const upserts: Record<string, unknown>[] = [];
  let maxCall = 0;
  let upsertCall = 0;
  const builder = {
    head: false,
    select(_cols: string, o?: { head?: boolean }) {
      builder.head = !!o?.head;
      return builder;
    },
    not() {
      return builder.head
        ? Promise.resolve({ count: opts.claimed, error: null })
        : builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      const max = opts.maxNumbers[Math.min(maxCall++, opts.maxNumbers.length - 1)];
      return Promise.resolve({ data: max ? { founding_member_number: max } : null, error: null });
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

  it("assigns max + 1, which skips gaps left by cleared numbers", async () => {
    const { client, upserts } = numberingClient({ claimed: 1, maxNumbers: [2], upsertErrors: [null] });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: null, memberNumber: 3 });
    expect(upserts[0].founding_member_number).toBe(3);
  });

  it("first member gets #1", async () => {
    const { client } = numberingClient({ claimed: 0, maxNumbers: [0], upsertErrors: [null] });
    expect((await upsertNewFoundingMember(row, "u1", client)).memberNumber).toBe(1);
  });

  it("retries with a fresh number on unique violation", async () => {
    const { client, upserts } = numberingClient({
      claimed: 4,
      maxNumbers: [4, 5],
      upsertErrors: [{ code: "23505" }, null],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: null, memberNumber: 6 });
    expect(upserts.map((u) => u.founding_member_number)).toEqual([5, 6]);
  });

  it("after repeated conflicts, writes the row without a number so access isn't lost", async () => {
    const { client, upserts } = numberingClient({
      claimed: 4,
      maxNumbers: [4],
      upsertErrors: [{ code: "23505" }, { code: "23505" }, { code: "23505" }, null],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: null, memberNumber: null });
    expect(upserts).toHaveLength(4);
    expect(upserts[3]).not.toHaveProperty("founding_member_number");
  });

  it("does not retry on non-conflict errors", async () => {
    const { client, upserts } = numberingClient({
      claimed: 0,
      maxNumbers: [0],
      upsertErrors: [{ code: "42501" }],
    });
    const r = await upsertNewFoundingMember(row, "u1", client);
    expect(r).toEqual({ upsertError: { code: "42501" }, memberNumber: null });
    expect(upserts).toHaveLength(1);
  });
});
