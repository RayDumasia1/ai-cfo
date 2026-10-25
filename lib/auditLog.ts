import { createServiceClient } from "@/utils/supabase/service";

interface SessionEventParams {
  userId: string | null;
  action: "login" | "logout" | "timeout" | "failed_login";
  ipAddress?: string;
  userAgent?: string;
  sessionDurationMinutes?: number;
  reason?: string;
  status: "success" | "failure";
}

const AUDIT_COLUMNS = new Set([
  "id",
  "user_id",
  "action",
  "ip_address",
  "user_agent",
  "timestamp",
  "session_duration_minutes",
  "reason",
  "status",
  "created_at",
]);

function nullViolationColumn(error: { code?: string; message?: string }): string | undefined {
  if (error.code !== "23502" || typeof error.message !== "string") return undefined;
  const column = error.message.match(/null value in column "([a-z_]+)"/i)?.[1];
  return column && AUDIT_COLUMNS.has(column) ? column : undefined;
}

/**
 * Records an auth event to session_audit_log.
 * This append-only server path uses the service client because logout removes
 * the user's authenticated session before the outcome can be recorded.
 * Failures never block the authentication action.
 */
export async function logSessionEvent(
  params: SessionEventParams
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("session_audit_log").insert({
      user_id: params.userId,
      action: params.action,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
      session_duration_minutes: params.sessionDurationMinutes ?? null,
      reason: params.reason ?? null,
      status: params.status,
    });
    if (error) {
      const column = nullViolationColumn(error);
      console.error("auditLog:insert:error", {
        reason: "database_error",
        action: params.action,
        code: typeof error.code === "string" ? error.code : "unknown",
        ...(column ? { column } : {}),
      });
    }
  } catch {
    console.error("auditLog:exception", { reason: "request_exception" });
  }
}
