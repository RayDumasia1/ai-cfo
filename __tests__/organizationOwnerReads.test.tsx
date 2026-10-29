import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../utils/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }), notFound: vi.fn(() => { throw new Error("notFound"); }), unstable_rethrow: vi.fn() }));
vi.mock("../app/dashboard/ImportRefresher", () => ({ default: () => <div>Uploader</div> }));
vi.mock("../app/components/FinancialDataOverviewCard", () => ({ default: ({ months }: { months: unknown[] }) => <div>Months: {months.length}</div> }));
vi.mock("../app/components/RecentFinancialImportsCard", () => ({ default: () => <div>History</div> }));
vi.mock("../app/components/FinancialDataProvenanceCard", () => ({ default: () => <div>Sources</div> }));
import { createClient } from "../utils/supabase/server";
import { getOwnerOrganizationMonths, getOwnerOrganizations } from "../lib/db";
import { organizationSelection, validateOwnerMonthlyRead, validateOwnerOrganizations } from "../lib/organizationAccess";
import FinancialDataPage from "../app/dashboard/financial-data/page";
import { GET } from "../app/api/organizations/route";
const owner = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const org = "20000000-0000-4000-8000-000000000001", profile = "30000000-0000-4000-8000-000000000001";
const ready = () => ({ state: "ready", context: { actorId: owner, organizationId: org, businessProfileId: profile, membershipId: "40000000-0000-4000-8000-000000000001",
  accessRevision: 1, membershipRevision: 1, dataVersion: "opaque-version", businessName: "Owner business", capability: "financial.months.read", policyVersion: "org-owner-read-1", entitlementTier: "core", entitlementSource: "legacy_subscription" },
months: [{ id: "50000000-0000-4000-8000-000000000001", user_id: owner, business_id: profile, organization_id:org, month_date: "2026-09-01", closing_cash: 0 }] });
const rpc = vi.fn(), from = vi.fn(), getUser = vi.fn(), query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
const client = { rpc, from, auth: { getUser } };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(createClient).mockResolvedValue(client as never);
  getUser.mockResolvedValue({ data: { user: { id: owner, email: "owner@example.invalid", email_confirmed_at: "2026-01-01" } }, error: null });
  rpc.mockResolvedValue({ data: ready(), error: null }); from.mockReturnValue(query);
  for (const method of ["select", "eq", "in", "order", "limit"] as const) query[method].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.restoreAllMocks());
describe("owner read context and selector validation", () => {
  it("normalizes only an explicit single UUID selector", () => {
    expect(organizationSelection(undefined)).toBeNull(); expect(organizationSelection(org.toUpperCase())).toBe(org);
    for (const bad of ["", "other", [org], [org, org]]) expect(() => organizationSelection(bad)).toThrow("invalid_selection");
  });
  it("retains null/zero and rejects cross-actor, cross-workspace and stale-policy responses", () => {
    expect(validateOwnerMonthlyRead(ready(), owner, org, null)).toEqual(ready());
    for (const mutate of [
      (r: ReturnType<typeof ready>) => { r.context.actorId = other; },
      (r: ReturnType<typeof ready>) => { r.context.organizationId = other; },
      (r: ReturnType<typeof ready>) => { r.context.policyVersion = "unknown"; },
      (r: ReturnType<typeof ready>) => { r.context.capability = "action.write"; },
      (r: ReturnType<typeof ready>) => { r.context.accessRevision = Number.MAX_SAFE_INTEGER + 1; },
      (r: ReturnType<typeof ready>) => { r.months[0].business_id = other; },
      (r: ReturnType<typeof ready>) => { r.months[0].user_id = other; },
      (r: ReturnType<typeof ready>) => { r.months[0].organization_id = other; },
      (r: ReturnType<typeof ready>) => { r.months.push(r.months[0]); },
    ]) { const r = ready(); mutate(r); expect(() => validateOwnerMonthlyRead(r, owner, org, null)).toThrow("unavailable"); }
    const missing = { state: "profile_missing", context: null, months: [] };
    expect(() => validateOwnerMonthlyRead(missing, owner, org, null)).toThrow("unavailable");
    expect(validateOwnerMonthlyRead(missing, owner, null, null)).toEqual(missing);
  });
  it("does not send an actor, role, tier or context as RPC authority", async () => {
    expect((await getOwnerOrganizationMonths(owner, org, null, client as never)).state).toBe("ready");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_owned_financial_months", { p_organization_id: org, p_limit: null }); expect(from).not.toHaveBeenCalled();
    rpc.mockClear(); await expect(getOwnerOrganizationMonths(owner, org, 241, client as never)).rejects.toThrow("invalid_selection"); expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable RPCs and never falls back to a legacy query", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private details" } });
    await expect(getOwnerOrganizationMonths(owner, org, null, client as never)).rejects.toThrow("unavailable"); expect(from).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } }); await expect(getOwnerOrganizationMonths(owner, org, null, client as never)).rejects.toThrow("not_found");
  });
  it("projects only owner-list display metadata and bounds this legacy bridge to one workspace", async () => {
    rpc.mockResolvedValue({ data: [{ id: org, businessName: null, private: "omit" }], error: null });
    expect(await getOwnerOrganizations(client as never)).toEqual([{ id: org, businessName: null }]);
    expect(() => validateOwnerOrganizations([{ id: org, businessName: null }, { id: other, businessName: "other" }])).toThrow("unavailable");
  });
});
describe("Financial Data owner-only read conversion", () => {
  it("loads unchanged owner content only after organization authorization", async () => {
    const html = renderToStaticMarkup(await FinancialDataPage({ searchParams: Promise.resolve({ organization_id: org }) }));
    expect(html).toContain("Financial data"); expect(html).toContain("Months: 1"); expect(html).toContain("Uploader");
    expect(rpc).toHaveBeenCalledWith("read_owned_financial_months", { p_organization_id: org, p_limit: null });
    expect(from.mock.calls.map(([table]) => table)).not.toContain("subscriptions");
    expect(from.mock.invocationCallOrder[0]).toBeGreaterThan(rpc.mock.invocationCallOrder[0]);
  });
  it("does not load history, upload controls or another account after invalid/foreign selection", async () => {
    await expect(FinancialDataPage({ searchParams: Promise.resolve({ organization_id: [org, other] }) })).rejects.toThrow("notFound"); expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    await expect(FinancialDataPage({ searchParams: Promise.resolve({ organization_id: other }) })).rejects.toThrow("notFound"); expect(from).not.toHaveBeenCalled();
  });
  it("distinguishes setup and target subscription redirects from data unavailability", async () => {
    rpc.mockResolvedValue({ data: { state: "profile_missing", context: null, months: [] }, error: null }); await expect(FinancialDataPage({})).rejects.toThrow("redirect:/dashboard");
    rpc.mockResolvedValue({ data: { state: "subscription_required", context: null, months: [] }, error: null }); await expect(FinancialDataPage({})).rejects.toThrow("redirect:/welcome");
    rpc.mockResolvedValue({ data: null, error: { code: "55000" } });
    const html = renderToStaticMarkup(await FinancialDataPage({})); expect(html).toContain("could not confirm access"); expect(html).not.toContain("Uploader"); expect(from).not.toHaveBeenCalled();
  });
});
describe("owner workspace discovery HTTP", () => {
  it("requires verified Auth and disables caching even on denial", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null }); const r = await GET(new NextRequest("https://example.invalid/api/organizations"), {});
    expect(r.status).toBe(401); expect(r.headers.get("cache-control")).toBe("no-store"); expect(rpc).not.toHaveBeenCalled();
    getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null }); expect((await GET(new NextRequest("https://example.invalid/api/organizations"), {})).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it("returns the SQL-bound owner list without accepting an actor or returning payment metadata", async () => {
    rpc.mockResolvedValue({ data: [{ id: org, businessName: "Business", stripe_id: "omit" }], error: null });
    const r = await GET(new NextRequest(`https://example.invalid/api/organizations?user_id=${other}`), {});
    expect(await r.json()).toEqual({ organizations: [{ id: org, businessName: "Business" }] }); expect(rpc).toHaveBeenCalledExactlyOnceWith("list_owned_organizations");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
