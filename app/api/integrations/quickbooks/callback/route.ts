import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { companyInfo, oauthHash, QUICKBOOKS_COOKIE, quickBooksConfig, requestTokens, sealTokens, validOAuthNonce } from "@/lib/quickbooks";
import { callbackResult, connectionAccess, connectionScope, noStore, operation } from "@/lib/quickbooksHttp";
export const runtime = "nodejs";

export const GET = requireAuth(async (req, session) => {
  let config;
  try { config = quickBooksConfig(); } catch { return NextResponse.json({ error: "QuickBooks sandbox connection is not configured yet." }, { status: 503, headers: noStore }); }
  // OAuth query strings, provider errors and authorization codes are never logged or reflected.
  try {
    if (req.nextUrl.origin !== config.origin) return callbackResult(config, "failed");
    const query = req.nextUrl.searchParams;
    if (["state", "realmId", "code", "error"].some(k => query.getAll(k).length > 1)) return callbackResult(config, "failed");
    const state = query.get("state"), browser = req.cookies.get(QUICKBOOKS_COOKIE)?.value;
    if (!validOAuthNonce(state) || !validOAuthNonce(browser)) return callbackResult(config, "failed");
    const access = await connectionAccess(session, true); if (access.error) return callbackResult(config, "failed");
    const call = access.call!, hashes = { stateHash: oauthHash(state), browserHash: oauthHash(browser) };
    if (query.has("error")) { await call("cancel_intent", hashes); return callbackResult(config, "cancelled"); }
    const code = query.get("code"), realmId = query.get("realmId");
    if (!code || code.length > 4096 || !realmId || !/^\d{1,30}$/.test(realmId)) return callbackResult(config, "failed");
    // Claim and consume the intent before the external request. Replays never exchange a code twice.
    const c = await call("claim", { ...hashes, realmId }); if (!c) return callbackResult(config, "failed");
    try {
      const tokens = await requestTokens(config, { code });
      // Retain encrypted grant before the company lookup, so a lookup failure can still be revoked.
      await call("store_grant", { ...operation(c), envelope: sealTokens(tokens, connectionScope(c), config), accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt });
      const company = await companyInfo(config, realmId, tokens.accessToken);
      await call("verify", { ...operation(c), companyName: company.name });
      return callbackResult(config, "connected");
    } catch { await call("fail", operation(c)); return callbackResult(config, "failed"); }
  } catch { return callbackResult(config, "failed"); }
});
