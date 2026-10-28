import type { FinancialMonth } from "./types";
import type { FeatureTier } from "./featureGates";

export class OrganizationAccessError extends Error {
  constructor(public readonly reason: "invalid_selection" | "not_found" | "unavailable" | "unauthorized") {
    super(reason); this.name = "OrganizationAccessError";
  }
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function organizationSelection(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (!uuid(value)) throw new OrganizationAccessError("invalid_selection");
  return value.toLowerCase();
}
export interface OwnerReadContext {
  actorId: string; organizationId: string; businessProfileId: string; membershipId: string;
  accessRevision: number; membershipRevision: number; dataVersion: string | null; businessName: string | null;
  capability: "financial.months.read"; policyVersion: "org-owner-read-1";
  entitlementTier: Exclude<FeatureTier, "suspended">; entitlementSource: "legacy_subscription";
}
export type OwnerMonthlyRead = { state: "ready"; context: OwnerReadContext; months: FinancialMonth[] }
  | { state: "profile_missing" | "subscription_required"; context: null; months: [] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export function validateOwnerMonthlyRead(raw: unknown, actorId: string, selected: string | null, limit: number | null): OwnerMonthlyRead {
  const invalid = () => { throw new OrganizationAccessError("unavailable"); };
  if (!object(raw) || !Array.isArray(raw.months)) return invalid();
  if (raw.state === "profile_missing" || raw.state === "subscription_required") {
    if (raw.context !== null || raw.months.length !== 0 || (raw.state === "profile_missing" && selected !== null)) return invalid();
    return raw as OwnerMonthlyRead;
  }
  const c = raw.context;
  if (raw.state !== "ready" || !object(c) || c.actorId !== actorId || !uuid(c.actorId) || !uuid(c.organizationId) ||
    !uuid(c.businessProfileId) || !uuid(c.membershipId) || (selected !== null && c.organizationId !== selected) ||
    !revision(c.accessRevision) || !revision(c.membershipRevision) || c.policyVersion !== "org-owner-read-1" ||
    c.capability !== "financial.months.read" || c.entitlementSource !== "legacy_subscription" ||
    !["starter", "core", "growth", "advisory"].includes(String(c.entitlementTier)) ||
    (c.dataVersion !== null && typeof c.dataVersion !== "string") || (c.businessName !== null && typeof c.businessName !== "string") ||
    raw.months.length > (limit ?? 240)) return invalid();
  const ids = new Set<string>(); let previous = "9999-99-99";
  for (const m of raw.months) {
    if (!object(m) || !uuid(m.id) || ids.has(m.id) || m.user_id !== actorId || m.business_id !== c.businessProfileId ||
      typeof m.month_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.month_date) || m.month_date > previous) return invalid();
    ids.add(m.id); previous = m.month_date;
  }
  return raw as unknown as OwnerMonthlyRead;
}
export interface OwnerOrganization { id: string; businessName: string | null }
export function validateOwnerOrganizations(raw: unknown): OwnerOrganization[] {
  if (!Array.isArray(raw) || raw.length > 1 || raw.some(o => !object(o) || !uuid(o.id) || (o.businessName !== null && typeof o.businessName !== "string"))) throw new OrganizationAccessError("unavailable");
  return raw.map(o => ({ id: o.id, businessName: o.businessName }));
}
