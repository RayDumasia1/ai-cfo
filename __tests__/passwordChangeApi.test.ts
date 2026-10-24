import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
import { createClient } from "../utils/supabase/server";
import { PATCH } from "../app/api/auth/password/route";

const getUser = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const client = { auth: { getUser, signInWithPassword, updateUser } };
const user = { id: "own-user", email: "own@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z" };
// Synthetic test credentials only. Never contact an Auth provider.
const valid = { currentPassword: " old-test-password ", newPassword: " new-test-password " };
function request(body: unknown = valid) {
  return new NextRequest("https://example.invalid/api/auth/password", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({ data: { user }, error: null });
  signInWithPassword.mockResolvedValue({ data: { user, session: { user } }, error: null });
  updateUser.mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("password-change validation and account boundary", () => {
  it.each([null, [], true, 12, "text", {}, { currentPassword: [], newPassword: valid.newPassword },
    { currentPassword: valid.currentPassword, newPassword: 12345678 },
    { currentPassword: {}, newPassword: {} }, { currentPassword: "", newPassword: valid.newPassword },
    { currentPassword: valid.currentPassword, newPassword: "short" }])("rejects invalid payload %# before Auth mutations", async body => {
    expect((await PATCH(request(body), {})).status).toBe(400);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON before Auth mutations", async () => {
    const req = new NextRequest("https://example.invalid/api/auth/password", { method: "PATCH", body: "{" });
    expect((await PATCH(req, {})).status).toBe(400);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it.each(["missing", "invalid", "unverified"])("rejects %s sessions before password work", async kind => {
    getUser.mockResolvedValue({ data: { user: kind === "missing" ? null : {
      ...user, email_confirmed_at: kind === "unverified" ? null : user.email_confirmed_at,
    } }, error: kind === "invalid" ? new Error("synthetic") : null });
    expect((await PATCH(request(), {})).status).toBe(kind === "unverified" ? 403 : 401);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("requires an authenticated email before reauthentication", async () => {
    getUser.mockResolvedValue({ data: { user: { ...user, email: undefined } }, error: null });
    expect((await PATCH(request(), {})).status).toBe(400);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it("preserves exact password bytes and ignores supplied identity fields", async () => {
    const response = await PATCH(request({ ...valid, email: "other@example.invalid", userId: "other", role: "admin" }), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: user.email, password: valid.currentPassword });
    expect(updateUser).toHaveBeenCalledExactlyOnceWith({ password: valid.newPassword });
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]);
  });
  it.each([null, { user: null, session: null }, { user: { id: "other" }, session: { user } },
    { user, session: null }, { user, session: { user: { id: "other" } } }])("does not update without matching reauthentication identity %#", async data => {
    signInWithPassword.mockResolvedValue({ data, error: null });
    expect((await PATCH(request(), {})).status).toBe(503);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("password-change provider outcomes", () => {
  it.each([
    ["invalid_credentials", 400, "CURRENT_PASSWORD_INCORRECT"],
    ["over_request_rate_limit", 429, "PASSWORD_RATE_LIMITED"],
    ["unexpected_failure", 503, "PASSWORD_CHANGE_UNAVAILABLE"],
  ])("maps reauthentication %s safely", async (code, status, responseCode) => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code, message: "synthetic private detail" } });
    const response = await PATCH(request(), {});
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code: responseCode });
    expect(updateUser).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic private detail");
  });
  it.each([
    ["weak_password", 422, "PASSWORD_REJECTED"], ["same_password", 422, "PASSWORD_REJECTED"],
    ["over_request_rate_limit", 429, "PASSWORD_RATE_LIMITED"],
    ["unexpected_failure", 500, "PASSWORD_CHANGE_FAILED"],
  ])("maps update %s safely", async (code, status, responseCode) => {
    updateUser.mockResolvedValue({ data: { user: null }, error: { code, message: "synthetic private detail" } });
    const response = await PATCH(request(), {});
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code: responseCode });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic private detail");
  });
  it.each([null, { user: null }, { user: { id: "other" } }])("does not confirm missing or mismatched update identity %#", async data => {
    updateUser.mockResolvedValue({ data, error: null });
    expect((await PATCH(request(), {})).status).toBe(500);
  });
  it.each(["reauthenticate", "update"])("safely contains thrown %s failures", async phase => {
    const operation = phase === "reauthenticate" ? signInWithPassword : updateUser;
    operation.mockRejectedValue(new Error("synthetic private detail"));
    const response = await PATCH(request(), {});
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify([body, vi.mocked(console.error).mock.calls])).not.toContain("synthetic private detail");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(valid.currentPassword);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(valid.newPassword);
    if (phase === "reauthenticate") expect(updateUser).not.toHaveBeenCalled();
  });
});
