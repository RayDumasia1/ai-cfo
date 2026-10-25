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
      console.error("auditLog:insert:error", {
        reason: "database_error",
        action: params.action,
        code: typeof error.code === "string" ? error.code : "unknown",
      });
    }
  } catch {
    console.error("auditLog:exception", { reason: "request_exception" });
  }
}
