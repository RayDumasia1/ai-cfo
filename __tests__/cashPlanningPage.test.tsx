import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../lib/db", () => ({ getSubscription: vi.fn(), hasPaidSubscription: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

import { createClient } from "../utils/supabase/server";
import { getSubscription, hasPaidSubscription } from "../lib/db";
import CashPlanningPage from "../app/dashboard/cash-planning/page";

const getUser = vi.fn();
const client = { auth: { getUser } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  getUser.mockResolvedValue({
    data: { user: { id: "owner", email: "owner@example.invalid", email_confirmed_at: "2026-01-01" } },
    error: null,
  });
  vi.mocked(hasPaidSubscription).mockResolvedValue(true);
  vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "starter" } as never);
});

describe("Cash planning foundation", () => {
  it("presents forecast and scenario engines as two owner tasks", async () => {
    const html = renderToStaticMarkup(await CashPlanningPage());
    expect(html).toContain("Cash planning");
    expect(html).toContain("Weekly cash plan");
    expect(html).toContain("Test a decision");
    expect(html).toContain("Core feature");
    expect(html).toContain("Available on your plan");
    expect(html).toContain('href="/dashboard/forecast"');
    expect(html).toContain('href="/dashboard/scenarios"');
  });

  it("recognizes Core access without changing the underlying forecast route", async () => {
    vi.mocked(getSubscription).mockResolvedValue({ feature_tier: "core" } as never);
    const html = renderToStaticMarkup(await CashPlanningPage());
    expect(html).not.toContain("Core feature");
    expect(html).toContain("Available on your plan");
    expect(html).toContain("Open weekly cash plan");
  });
});

