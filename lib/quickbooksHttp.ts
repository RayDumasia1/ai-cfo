import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { AuthedSession } from "./apiAuth";
import { getBusinessProfile, hasPaidSubscription, quickBooksLifecycle, type QuickBooksConnectionRecord } from "./db";
import { checkFeatureGate } from "./apiGate";
import { createServiceClient } from "@/utils/supabase/service";
import { QUICKBOOKS_COOKIE, quickBooksConfig, openTokens, revokeTokens, type CredentialScope, type QuickBooksConfig } from "./quickbooks";

export function connectionScope(c: QuickBooksConnectionRecord, credential = false): CredentialScope {
  if (!c.realmId) throw new Error("Company binding missing");
  return { businessId: c.businessId, connectionId: c.id, generation: credential ? c.credentialGeneration ?? c.generation : c.generation, realmId: c.realmId, environment: c.environment };
}
export function operation(c: QuickBooksConnectionRecord) { return { generation: c.generation, operationId: c.operationId }; }
export function safeConnection(c: QuickBooksConnectionRecord | null) {
  return c ? { status: c.status, companyName: c.companyName, environment: c.environment, connectedAt: c.connectedAt } : { status: "disconnected", companyName: null, environment: "sandbox", connectedAt: null };
}
export const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function connectionAccess(session: AuthedSession, entitled: boolean) {
  if (entitled) {
    const gate = await checkFeatureGate(session.userId, session.email, "quickbooks_sync", session.supabase);
    if (gate) return { error: gate };
    if (!await hasPaidSubscription(session.userId, session.supabase)) return { error: NextResponse.json({ error: "An active Core subscription is required." }, { status: 402, headers: noStore }) };
  }
  const profile = await getBusinessProfile(session.userId, session.supabase);
  if (!profile) return { error: NextResponse.json({ error: "Complete your business setup first." }, { status: 409, headers: noStore }) };
  const service = createServiceClient();
  return { call: (action: string, input: Record<string, unknown> = {}) => quickBooksLifecycle(session.userId, profile.id, action, input, service) };
}
export function sameOrigin(req: NextRequest, config: QuickBooksConfig): boolean {
  return req.headers.get("origin") === config.origin && req.nextUrl.origin === config.origin;
}
export function callbackResult(config: QuickBooksConfig, result: "connected" | "cancelled" | "failed") {
  const response = NextResponse.redirect(new URL(`/dashboard/settings?tab=connections&quickbooks=${result}`, config.origin), 303);
  for (const [k, v] of Object.entries(noStore)) response.headers.set(k, v);
  response.cookies.set(QUICKBOOKS_COOKIE, "", { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/quickbooks", maxAge: 0 });
  return response;
}
export function connectionError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = code === "SETUP_REQUIRED" ? 503 : code === "42501" ? 403 : ["55000", "40001", "P0002"].includes(code) ? 409 : 502;
  const message = status === 503 ? "QuickBooks sandbox connection is not configured yet." : status === 409 ? "Another connection operation is in progress, or the connection changed. Reload and try again. If it remains busy, wait two minutes and disconnect before reconnecting." : status === 403 ? "Connection access is no longer available." : "QuickBooks could not complete the request. Try again, or disconnect before reconnecting.";
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
/** Local access is fenced first. Keep the encrypted credential for a revocation retry.
 * A new authorization is forbidden until revocation completes, so an old revoke
 * cannot race a newer connection to the same Intuit company.
 */
export async function disconnectQuickBooks(call: NonNullable<Awaited<ReturnType<typeof connectionAccess>>["call"]>) {
  const c = await call("disconnect_claim");
  if (!c || c.status === "disconnected") return c;
  try {
    const config = quickBooksConfig();
    if (!c.envelope) throw new Error("Missing revocation credential");
    const tokens = openTokens(c.envelope, connectionScope(c, true), config);
    await revokeTokens(config, tokens.refreshToken);
    return await call("disconnect_finish", operation(c));
  } catch {
    return await call("disconnect_fail", operation(c));
  }
}
