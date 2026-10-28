import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { hasPaidSubscription } from "@/lib/db";
import { checkFeatureGate } from "@/lib/apiGate";
import { authorizationUrl, oauthHash, oauthNonce, openTokens, QUICKBOOKS_COOKIE, quickBooksConfig, requestTokens, sealTokens } from "@/lib/quickbooks";
import { connectionAccess, connectionError, connectionScope, disconnectQuickBooks, noStore, operation, safeConnection, sameOrigin } from "@/lib/quickbooksHttp";
export const runtime = "nodejs";

export const GET = requireAuth(async (_req, session) => {
  try {
    const access = await connectionAccess(session, false); if (access.error) return access.error;
    const c = await access.call!("read");
    const eligible = !await checkFeatureGate(session.userId, session.email, "quickbooks_sync", session.supabase) && await hasPaidSubscription(session.userId, session.supabase);
    let configured = true; try { quickBooksConfig(); } catch { configured = false; }
    return NextResponse.json({ connection: safeConnection(c), eligible, configured, syncAvailable: false }, { headers: noStore });
  } catch (e) { return connectionError(e); }
});

export const POST = requireAuth(async (req, session) => {
  try {
    // Origin is trusted configuration, never an untrusted Host/return URL.
    // Disconnect remains available after a plan downgrade or provider setup failure.
    let config;
    try { config = quickBooksConfig(); } catch { /* allow local fencing below */ }
    let expectedOrigin = config?.origin;
    if (!expectedOrigin) try { expectedOrigin = new URL(process.env.QUICKBOOKS_REDIRECT_URI ?? process.env.NEXT_PUBLIC_APP_URL ?? "").origin; } catch { /* reject without a configured origin */ }
    if (!expectedOrigin || req.headers.get("origin") !== expectedOrigin || req.nextUrl.origin !== expectedOrigin || (config && !sameOrigin(req, config))) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
    if (Number(req.headers.get("content-length") ?? 0) > 1024) return NextResponse.json({ error: "Request too large." }, { status: 413, headers: noStore });
    const reader = req.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length;
      if (length > 1024) { await reader.cancel(); return NextResponse.json({ error: "Request too large." }, { status: 413, headers: noStore }); } chunks.push(value); }
    const text = Buffer.concat(chunks).toString("utf8");
    let body; try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore }); }
    if (!body || !["connect", "disconnect", "refresh"].includes(body.action) || Object.keys(body).length !== 1) return NextResponse.json({ error: "Choose a connection action." }, { status: 400, headers: noStore });
    const access = await connectionAccess(session, body.action !== "disconnect"); if (access.error) return access.error;
    const call = access.call!;
    if (body.action === "disconnect") return NextResponse.json({ connection: safeConnection(await disconnectQuickBooks(call)) }, { headers: noStore });
    config ??= quickBooksConfig();
    if (body.action === "connect") {
      const state = oauthNonce(), browser = oauthNonce();
      await call("start", { stateHash: oauthHash(state), browserHash: oauthHash(browser) });
      const response = NextResponse.json({ authorizationUrl: authorizationUrl(state, config) }, { headers: noStore });
      response.cookies.set(QUICKBOOKS_COOKIE, browser, { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/quickbooks", maxAge: 600 });
      return response;
    }
    const c = await call("refresh_claim"); if (!c) throw new Error("Connection missing");
    try {
      if (!c.envelope) throw new Error("Credential missing");
      const prior = openTokens(c.envelope, connectionScope(c, true), config);
      const tokens = await requestTokens(config, { refreshToken: prior.refreshToken }, Date.now(), prior.hardExpiresAt);
      const saved = await call("refresh_finish", { ...operation(c), envelope: sealTokens(tokens, connectionScope(c), config), accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt });
      return NextResponse.json({ connection: safeConnection(saved) }, { headers: noStore });
    } catch (e) { await call("fail", operation(c)); throw e; }
  } catch (e) { return connectionError(e); }
});
