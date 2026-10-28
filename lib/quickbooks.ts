import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Server consumers only. No SDK logging: OAuth responses contain credentials.
export const QUICKBOOKS_CALLBACK = "/api/integrations/quickbooks/callback";
export const QUICKBOOKS_COOKIE = "elidan_qbo_nonce";
export interface QuickBooksConfig {
  clientId: string; clientSecret: string; redirectUri: string; origin: string;
  environment: "sandbox"; activeKeyId: string; keys: Record<string, Buffer>;
}
export class QuickBooksError extends Error {
  constructor(public readonly code: "SETUP_REQUIRED" | "PROVIDER_UNAVAILABLE" | "INVALID_GRANT" | "INVALID_RESPONSE") {
    super(code); this.name = "QuickBooksError";
  }
}
export function quickBooksConfig(env: Record<string, string | undefined> = process.env): QuickBooksConfig {
  try {
    const clientId = env.QUICKBOOKS_CLIENT_ID?.trim(), clientSecret = env.QUICKBOOKS_CLIENT_SECRET?.trim();
    const uri = new URL(env.QUICKBOOKS_REDIRECT_URI ?? "");
    const local = env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(uri.hostname);
    if (!clientId || !clientSecret || uri.username || uri.password || uri.search || uri.hash ||
      uri.pathname !== QUICKBOOKS_CALLBACK || (uri.protocol !== "https:" && !(local && uri.protocol === "http:")) ||
      env.QUICKBOOKS_ENVIRONMENT !== "sandbox") throw new Error();
    // INT-01B deliberately enables sandbox authorization only, including hosted preview.
    const activeKeyId = env.QUICKBOOKS_ACTIVE_TOKEN_KEY_ID ?? "";
    const raw: unknown = JSON.parse(env.QUICKBOOKS_TOKEN_KEYS ?? "");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    const keys: Record<string, Buffer> = Object.create(null);
    for (const [id, value] of Object.entries(raw)) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || typeof value !== "string") throw new Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value) throw new Error();
      keys[id] = key;
    }
    if (!keys[activeKeyId]) throw new Error();
    return { clientId, clientSecret, redirectUri: uri.href, origin: uri.origin, environment: "sandbox", activeKeyId, keys };
  } catch { throw new QuickBooksError("SETUP_REQUIRED"); }
}
export const oauthNonce = () => randomBytes(32).toString("base64url");
export const oauthHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validOAuthNonce = (value: string | undefined | null): value is string => !!value && /^[\w-]{43}$/.test(value);
export interface CredentialScope { businessId: string; connectionId: string; generation: string; realmId: string; environment: "sandbox" }
export interface QuickBooksTokens { accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string; hardExpiresAt: string | null }
export interface TokenEnvelope { version: 1; keyId: string; iv: string; ciphertext: string; tag: string }
const aad = (s: CredentialScope, keyId: string) => Buffer.from(JSON.stringify(["qbo-1", keyId, s.businessId, s.connectionId, s.generation, s.realmId, s.environment]));
export function sealTokens(tokens: QuickBooksTokens, scope: CredentialScope, config: QuickBooksConfig): TokenEnvelope {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.keys[config.activeKeyId], iv);
  cipher.setAAD(aad(scope, config.activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return { version: 1, keyId: config.activeKeyId, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function openTokens(envelope: TokenEnvelope, scope: CredentialScope, config: QuickBooksConfig): QuickBooksTokens {
  try {
    if (envelope.version !== 1 || !config.keys[envelope.keyId]) throw new Error();
    const iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", config.keys[envelope.keyId], iv);
    decipher.setAAD(aad(scope, envelope.keyId)); decipher.setAuthTag(tag);
    const t = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    if (!t.accessToken || !t.refreshToken || !Number.isFinite(Date.parse(t.accessExpiresAt)) || !Number.isFinite(Date.parse(t.refreshExpiresAt))) throw new Error();
    return t;
  } catch { throw new QuickBooksError("INVALID_RESPONSE"); }
}
export function authorizationUrl(state: string, config: QuickBooksConfig): string {
  const u = new URL("https://appcenter.intuit.com/connect/oauth2");
  u.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: config.redirectUri, state }).toString();
  return u.href;
}
const tokenEndpoint = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
async function providerRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch { throw new QuickBooksError("PROVIDER_UNAVAILABLE"); }
}
const basic = (c: QuickBooksConfig) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  // Bound streamed bodies too; a dishonest/missing Content-Length must not bypass the limit.
  const reader = response.body?.getReader(); if (!reader) throw new QuickBooksError("INVALID_RESPONSE");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length;
      if (length > 262144) { await reader.cancel(); throw new Error(); } chunks.push(value); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new QuickBooksError("INVALID_RESPONSE"); }
}
export async function requestTokens(config: QuickBooksConfig, grant: { code: string } | { refreshToken: string }, now = Date.now(), previousHardExpiry: string | null = null): Promise<QuickBooksTokens> {
  const body: Record<string, string> = "code" in grant ? { grant_type: "authorization_code", code: grant.code, redirect_uri: config.redirectUri } : { grant_type: "refresh_token", refresh_token: grant.refreshToken };
  const response = await providerRequest(tokenEndpoint, { method: "POST", headers: { Authorization: basic(config), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "x-include-refresh-token-hard-expires-in": "true" }, body: new URLSearchParams(body).toString() });
  if (!response.ok) { await response.body?.cancel(); throw new QuickBooksError(response.status === 400 || response.status === 401 ? "INVALID_GRANT" : "PROVIDER_UNAVAILABLE"); }
  const data = await boundedJson(response);
  const token = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 16384 && !/[\r\n]/.test(v);
  const duration = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10 * 366 * 86400;
  if (!token(data.access_token) || !token(data.refresh_token) || String(data.token_type).toLowerCase() !== "bearer" || !duration(data.expires_in) || !duration(data.x_refresh_token_expires_in)) throw new QuickBooksError("INVALID_RESPONSE");
  const hardSeconds = data.x_refresh_token_hard_expires_in;
  if (hardSeconds !== undefined && !duration(hardSeconds)) throw new QuickBooksError("INVALID_RESPONSE");
  const hard = hardSeconds === undefined ? previousHardExpiry : new Date(Math.min(now + (hardSeconds as number) * 1000, previousHardExpiry ? Date.parse(previousHardExpiry) : Infinity)).toISOString();
  return { accessToken: data.access_token as string, refreshToken: data.refresh_token as string,
    accessExpiresAt: new Date(now + data.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(Math.min(now + data.x_refresh_token_expires_in * 1000, hard ? Date.parse(hard) : Infinity)).toISOString(), hardExpiresAt: hard };
}
export async function companyInfo(config: QuickBooksConfig, realmId: string, accessToken: string): Promise<{ name: string; currency: string | null }> {
  if (!/^\d{1,30}$/.test(realmId)) throw new QuickBooksError("INVALID_RESPONSE");
  const response = await providerRequest(`https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!response.ok) { await response.body?.cancel(); throw new QuickBooksError("PROVIDER_UNAVAILABLE"); }
  const data = await boundedJson(response), info = data.CompanyInfo as Record<string, unknown> | undefined;
  // CompanyInfo.Id identifies the metadata object (often "1"), not the OAuth realm.
  // Successful authorization at the fixed realm-scoped endpoint confirms access.
  if (!info || !/^\d+$/.test(String(info.Id)) || typeof info.CompanyName !== "string" || !info.CompanyName.trim()) throw new QuickBooksError("INVALID_RESPONSE");
  // CompanyInfo need not expose home currency. Unknown remains unknown until the retrieval increment.
  return { name: info.CompanyName.trim().slice(0, 200), currency: null };
}
export async function revokeTokens(config: QuickBooksConfig, refreshToken: string): Promise<void> {
  const response = await providerRequest("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", { method: "POST", headers: { Authorization: basic(config), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token: refreshToken }) });
  await response.body?.cancel(); if (!response.ok) throw new QuickBooksError("PROVIDER_UNAVAILABLE");
}
