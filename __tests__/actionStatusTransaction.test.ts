import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/db")>(),
  getAction: vi.fn(), getSubscription: vi.fn(), getActiveActionCount: vi.fn(),
}));
import { createClient } from "../utils/supabase/server";
import { updateAction, getAction, getSubscription, getActiveActionCount } from "../lib/db";
import { PATCH } from "../app/api/actions/[id]/route";

const getUser = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const client = { auth: { getUser }, rpc, from };
const ownUser = { id: "own-user", email: "test@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
const action = { id: "own-action", user_id: "own-user", status: "completed", name: "Test action" };
const auditFailure = { code: "42501", message: "synthetic private audit failure" };
const ctx = { params: Promise.resolve({ id: "own-action" }) };
const request = (body: unknown = { status: "completed" }) => new NextRequest("https://example.invalid/api/actions/own-action", {
  method: "PATCH", body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user: ownUser }, error: null });
  vi.mocked(createClient).mockResolvedValue(client as never);
  rpc.mockResolvedValue({ data: action, error: null });
  vi.mocked(getAction).mockResolvedValue({ ...action, status: "not_started" } as never);
  vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "starter" } as never);
  vi.mocked(getActiveActionCount).mockResolvedValue(1);
  // Reproduce the legacy path: the action update succeeds; audit insert fails.
  const legacy = {
    select: vi.fn(() => legacy), eq: vi.fn(() => legacy), update: vi.fn(() => legacy),
    single: vi.fn().mockResolvedValueOnce({ data: { status: "not_started" }, error: null })
      .mockResolvedValue({ data: action, error: null }),
    insert: vi.fn(async () => ({ data: null, error: auditFailure })),
  };
  from.mockReturnValue(legacy);
});
afterEach(() => vi.restoreAllMocks());

describe("atomic action update helper", () => {
  it("rejects an audit failure rather than reporting a successful status change", async () => {
    rpc.mockResolvedValue({ data: null, error: auditFailure });
    await expect(updateAction("own-user", "own-action", { status: "completed" }, {}, client as never)).rejects.toEqual(auditFailure);
  });
  it("sends one scoped transaction call and never performs separate reads/updates/audit inserts", async () => {
    const updates = { status: "completed" as const, actual_impact: 123 };
    expect(await updateAction("own-user", "own-action", updates, {}, client as never)).toEqual(action);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_action_with_audit", {
      p_user_id: "own-user", p_action_id: "own-action", p_updates: updates, p_audit_note: null,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("preserves optional audit notes in the same transaction", async () => {
    await updateAction("own-user", "own-action", { status: "completed" }, { auditNote: "Verified outcome" }, client as never);
    expect(rpc).toHaveBeenCalledWith("update_action_with_audit", expect.objectContaining({ p_audit_note: "Verified outcome" }));
  });
  it("does not fall back to separate writes if the migration is missing", async () => {
    const error = { code: "PGRST202", message: "RPC not found" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(updateAction("own-user", "own-action", { status: "completed" }, {}, client as never)).rejects.toEqual(error);
    expect(from).not.toHaveBeenCalled();
  });
  it("propagates a rejected transaction request without issuing another write", async () => {
    rpc.mockRejectedValue(new Error("Synthetic connection failure"));
    await expect(updateAction("own-user", "own-action", { status: "completed" }, {}, client as never)).rejects.toThrow("Synthetic connection failure");
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });
  it("uses the same scoped transaction for a non-status edit", async () => {
    await updateAction("own-user", "own-action", { name: "Renamed" }, {}, client as never);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_action_with_audit", expect.objectContaining({ p_updates: { name: "Renamed" } }));
    expect(from).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...action, id: "other-action" }, { ...action, user_id: "other-user" }])("does not confirm an invalid transaction result %#", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(updateAction("own-user", "own-action", { status: "completed" }, {}, client as never)).rejects.toThrow("Could not confirm action update");
  });
});

describe("action PATCH transaction integration", () => {
  it("forwards only validated updates and authenticated ownership", async () => {
    const response = await PATCH(request({ status: "completed", user_id: "other", business_id: "other", old_status: "completed" }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(action);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_action_with_audit", {
      p_user_id: "own-user", p_action_id: "own-action", p_updates: { status: "completed" }, p_audit_note: null,
    });
  });
  it("returns safe failure JSON when the atomic audit/write operation fails", async () => {
    rpc.mockResolvedValue({ data: null, error: auditFailure });
    const response = await PATCH(request(), ctx);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to update action.", requestId: expect.any(String) });
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain("synthetic private audit failure");
  });
  it("still returns the established limit response for a rejected reopening", async () => {
    vi.mocked(getAction).mockResolvedValue(action as never);
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "action_limit_reached", details: "10" } });
    const response = await PATCH(request({ status: "in_progress" }), ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "limit_reached", limit: 10 });
  });
  it("does not call the transaction for an inaccessible action", async () => {
    vi.mocked(getAction).mockResolvedValue(null);
    expect((await PATCH(request(), ctx)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { status: "invalid" }])("rejects invalid input %# before a transaction", async body => {
    expect((await PATCH(request(body), ctx)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["missing", "invalid", "unverified"])("blocks %s authentication before data work", async kind => {
    getUser.mockResolvedValue({ data: { user: kind === "missing" ? null : {
      ...ownUser, email_confirmed_at: kind === "unverified" ? null : ownUser.email_confirmed_at,
    } }, error: kind === "invalid" ? new Error("Invalid session") : null });
    expect((await PATCH(request(), ctx)).status).toBe(kind === "unverified" ? 403 : 401);
    expect(getAction).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
