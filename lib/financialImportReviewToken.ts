import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isFinancialImportMode, type FinancialImportMode } from "./financialImportPolicy";

export const IMPORT_REVIEW_TTL_SECONDS = 15 * 60;
interface ReviewClaims {
  version: 2;
  userId: string;
  mode: FinancialImportMode;
  filename: string;
  fileHash: string;
  stateVersion: string;
  expiresAt: number;
  organizationId: string;
}
type ReviewIdentity = Pick<ReviewClaims, "userId" | "mode" | "filename" | "fileHash"> & {organizationId?:string|null};

function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Import review signing is unavailable");
  // Domain-separate this use from the service key's other responsibilities.
  return createHmac("sha256", secret).update("elidan:financial-import-review:v2").digest();
}
export function importFileHash(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}
export function issueImportReviewToken(identity: ReviewIdentity, stateVersion: string, now = Date.now()): string {
  if(!identity.organizationId||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(identity.organizationId))throw new Error("Verified workspace required for import review");
  const claims: ReviewClaims = { version: 2, ...identity, organizationId:identity.organizationId,stateVersion,
    expiresAt: Math.floor(now / 1000) + IMPORT_REVIEW_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", signingKey()).update(payload).digest("hex")}`;
}
export function verifyScopedImportReviewToken(token: string, identity: ReviewIdentity, now = Date.now()):{stateVersion:string;organizationId:string}|null {
  if (token.length > 16384) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const signature = createHmac("sha256", signingKey()).update(parts[0]).digest();
  if (!timingSafeEqual(signature, Buffer.from(parts[1], "hex"))) return null;
  let claims: ReviewClaims;
  try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!claims || claims.version !== 2 || !isFinancialImportMode(claims.mode) || typeof claims.organizationId!=="string"||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(claims.organizationId)||(identity.organizationId!=null&&identity.organizationId!==claims.organizationId)||
    claims.userId !== identity.userId || claims.mode !== identity.mode || claims.filename !== identity.filename ||
    claims.fileHash !== identity.fileHash || typeof claims.stateVersion !== "string" || !/^[a-f0-9]{32}$/.test(claims.stateVersion) ||
    !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= Math.floor(now / 1000)) return null;
  return {stateVersion:claims.stateVersion,organizationId:claims.organizationId};
}
export function verifyImportReviewToken(token:string,identity:ReviewIdentity,now=Date.now()):string|null{
  return verifyScopedImportReviewToken(token,identity,now)?.stateVersion??null;
}
