import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceClient, insert } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../utils/supabase/service", () => ({ createServiceClient }));

import { logSessionEvent } from "../lib/auditLog";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createServiceClient.mockReturnValue({
    from: vi.fn(() => ({ insert })),
  });
  insert.mockResolvedValue({ error: null });
});

afterEach(() => vi.restoreAllMocks());

describe("session audit logging", () => {
  it("uses the trusted server client after authentication state changes", async () => {
    await logSessionEvent({
      userId: "account-1",
      action: "logout",
      status: "success",
      reason: "manual logout",
    });

    expect(createServiceClient).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      user_id: "account-1",
      action: "logout",
      status: "success",
    }));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not fail authentication or log raw database details", async () => {
    insert.mockResolvedValue({ error: new Error("permission denied secret detail") });

    await expect(logSessionEvent({
      userId: "account-1",
      action: "login",
      status: "success",
    })).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "auditLog:insert:error",
      { reason: "database_error" }
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret detail");
  });

  it("records failed logins without inventing an account UUID", async () => {
    await logSessionEvent({
      userId: null,
      action: "failed_login",
      status: "failure",
      reason: "invalid credentials",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: null,
      action: "failed_login",
    }));
  });
});
