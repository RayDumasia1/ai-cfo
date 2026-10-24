import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({
  createAction: vi.fn(), getAction: vi.fn(), updateAction: vi.fn(), deleteAction: vi.fn(),
  getActiveActionCount: vi.fn(), getSubscription: vi.fn(),
}));

import { createClient } from "../utils/supabase/server";
import { createAction, getAction, updateAction, getActiveActionCount, getSubscription } from "../lib/db";
import { getActionCapacityError } from "../lib/actions";
import { USAGE_LIMITS } from "../lib/featureGates";
import { POST } from "../app/api/actions/route";
import { PATCH } from "../app/api/actions/[id]/route";

const getUser = vi.fn();
const client = { auth: { getUser } };
const ownUser = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
const ctx = { params: Promise.resolve({ id: "own-action" }) };
const capacity = (limit = 10) => ({ code: "P0001", message: "action_limit_reached", details: String(limit) });
const action = { id: "own-action", user_id: "own-user", name: "Test action", status: "not_started" };
function request(method: "POST" | "PATCH", body?: unknown) {
  return new NextRequest("https://example.invalid/api/actions?user_id=other", {
    method, body: JSON.stringify(body ?? (method === "POST"
      ? { name: "Test action", goal_type: "risk_mitigation", user_id: "other" }
      : { status: "in_progress", user_id: "other" })),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user: ownUser }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "starter" } as never);
  vi.mocked(getActiveActionCount).mockResolvedValue(9);
  vi.mocked(getAction).mockResolvedValue({ ...action, status: "completed" } as never);
  vi.mocked(createAction).mockResolvedValue(action as never);
  vi.mocked(updateAction).mockResolvedValue(action as never);
});
afterEach(() => vi.restoreAllMocks());

describe("action capacity signal", () => {
  it.each([0, 10, 50])("recognizes the dedicated capacity signal with limit %s", limit => {
    expect(getActionCapacityError(capacity(limit))).toEqual({ limit });
  });
  it.each([null, [], "limit_reached", {}, { ...capacity(), code: "42501" },
    { ...capacity(), message: "something else" }, { ...capacity(), details: "10 private detail" },
    capacity(20), capacity(-1), { ...capacity(), details: 10 }, { ...capacity(), details: "01" },
    { ...capacity(), details: "Infinity" }])("does not disguise unrelated/malformed failures as capacity errors %#", error => {
    expect(getActionCapacityError(error)).toBeNull();
  });
  it("keeps database tier limits aligned with the UI/API configuration", () => {
    const sql = readFileSync(new URL("../docs/migrations/2026-10-23-action-capacity-guard.sql", import.meta.url), "utf8");
    for (const tier of ["suspended", "starter", "core"] as const) {
      expect(sql).toContain(`WHEN '${tier}' THEN v_limit := ${USAGE_LIMITS[tier].actions_active};`);
    }
    expect(USAGE_LIMITS.growth.actions_active).toBeNull();
    expect(USAGE_LIMITS.advisory.actions_active).toBeNull();
    expect(sql).toContain("WHEN 'growth', 'advisory' THEN RETURN NULL;");
  });
});

describe("action API capacity conflicts after a stale preflight", () => {
  it.each(["create", "reopen"])("returns the established 403 contract for a database-rejected %s", async operation => {
    const mutate = operation === "create" ? createAction : updateAction;
    vi.mocked(mutate).mockRejectedValue(capacity());
    const response = operation === "create" ? await POST(request("POST"), {}) : await PATCH(request("PATCH"), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "limit_reached", limit: 10 });
    expect(getActiveActionCount).toHaveBeenCalledWith("own-user", client);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("handles competing creates when both preflights see the final free slot", async () => {
    // Simulate the database accepting one transaction and rejecting its rival.
    // This tests HTTP wiring; it is NOT a PostgreSQL concurrency test.
    vi.mocked(createAction).mockResolvedValueOnce(action as never).mockRejectedValueOnce(capacity());
    const responses = await Promise.all([POST(request("POST"), {}), POST(request("POST"), {})]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 403]);
    expect(createAction).toHaveBeenCalledTimes(2);
    expect(createAction).toHaveBeenCalledWith("own-user", expect.not.objectContaining({ user_id: expect.anything() }), client);
  });
  it("handles a stale PATCH preflight even if the earlier read said it was already active", async () => {
    vi.mocked(getAction).mockResolvedValue(action as never);
    vi.mocked(updateAction).mockRejectedValue(capacity());
    expect((await PATCH(request("PATCH"), ctx)).status).toBe(403);
    expect(getActiveActionCount).not.toHaveBeenCalled();
  });
  it.each(["create", "reopen"])("preserves the fast preflight rejection for %s", async operation => {
    vi.mocked(getActiveActionCount).mockResolvedValue(10);
    const response = operation === "create" ? await POST(request("POST"), {}) : await PATCH(request("PATCH"), ctx);
    expect(response.status).toBe(403);
    expect(createAction).not.toHaveBeenCalled();
    expect(updateAction).not.toHaveBeenCalled();
  });
  it("still permits creating a completed action at the active limit", async () => {
    vi.mocked(getActiveActionCount).mockResolvedValue(10);
    expect((await POST(request("POST", { name: "Done", goal_type: "risk_mitigation", status: "completed" }), {})).status).toBe(201);
    expect(createAction).toHaveBeenCalled();
  });
  it("still permits completion at the limit", async () => {
    vi.mocked(getAction).mockResolvedValue(action as never);
    expect((await PATCH(request("PATCH", { status: "completed" }), ctx)).status).toBe(200);
    expect(getActiveActionCount).not.toHaveBeenCalled();
    expect(updateAction).toHaveBeenCalledWith("own-user", "own-action", { status: "completed" }, {}, client);
  });
  it.each(["create", "reopen"])("keeps unrelated %s errors generic with safe correlated logging", async operation => {
    const mutate = operation === "create" ? createAction : updateAction;
    vi.mocked(mutate).mockRejectedValue({ code: "42501", message: "private detail", details: "private detail" });
    const response = operation === "create" ? await POST(request("POST"), {}) : await PATCH(request("PATCH"), ctx);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain("private detail");
    expect(console.error).toHaveBeenCalledWith(`actions:${operation === "create" ? "create" : "update"}:error`, {
      requestId: body.requestId, userId: "own-user",
    });
  });
  it.each(["create", "reopen"])("blocks unauthenticated %s before any database work", async operation => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = operation === "create" ? await POST(request("POST"), {}) : await PATCH(request("PATCH"), ctx);
    expect(response.status).toBe(401);
    expect(getSubscription).not.toHaveBeenCalled();
    expect(getAction).not.toHaveBeenCalled();
    expect(createAction).not.toHaveBeenCalled();
    expect(updateAction).not.toHaveBeenCalled();
  });
});
