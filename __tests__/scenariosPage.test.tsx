import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({
  getCurrentCashPosition: vi.fn(),
  getFinancialMonths: vi.fn(),
  hasPaidSubscription: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

import { createClient } from "../utils/supabase/server";
import { getCurrentCashPosition, getFinancialMonths, hasPaidSubscription } from "../lib/db";
import ScenariosPage from "../app/dashboard/scenarios/page";

const getUser = vi.fn();
const client = { auth: { getUser } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  getUser.mockResolvedValue({
    data: { user: { id: "own-account", email: "owner@example.invalid", email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(getCurrentCashPosition).mockResolvedValue(null);
  vi.mocked(getFinancialMonths).mockResolvedValue([]);
});

describe("Scenarios page boundary", () => {
  it.each(["missing", "auth_error", "unverified", "unpaid"])(
    "rejects %s before reading financial data",
    async (condition) => {
      if (condition === "missing") getUser.mockResolvedValue({ data: { user: null }, error: null });
      if (condition === "auth_error") getUser.mockResolvedValue({ data: { user: { id: "own-account" } }, error: new Error("Auth failed") });
      if (condition === "unverified") getUser.mockResolvedValue({ data: { user: { id: "own-account", email: "owner@example.invalid" } }, error: null });
      if (condition === "unpaid") vi.mocked(hasPaidSubscription).mockResolvedValue(false);

      await expect(ScenariosPage()).rejects.toThrow(
        condition === "unpaid" ? "redirect:/welcome" :
          condition === "unverified" ? "redirect:/auth/verify" : "redirect:/auth?reason=session_expired"
      );
      expect(getCurrentCashPosition).not.toHaveBeenCalled();
      expect(getFinancialMonths).not.toHaveBeenCalled();
    }
  );

  it("loads only the authenticated account and presents the dedicated planning workflow", async () => {
    const html = renderToStaticMarkup(await ScenariosPage());
    expect(getCurrentCashPosition).toHaveBeenCalledExactlyOnceWith("own-account", client);
    expect(getFinancialMonths).toHaveBeenCalledWith("own-account", expect.any(Number), client);
    expect(html).toContain("Test a decision");
    expect(html).toContain("No saved financial baseline yet");
    expect(html).toContain("Decision tests are temporary");
    expect(html).toContain('href="/dashboard/actions"');
    expect(html).toContain('href="/dashboard/cash-planning"');
  });
});
