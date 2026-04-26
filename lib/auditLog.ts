import { createClient } from "@/utils/supabase/server";

interface SessionEventParams {
  userId: string;
  action: "login" | "logout" | "timeout" | "failed_login";
  ipAddress?: string;
  userAgent?: string;
  sessionDurationMinutes?: number;
  reason?: string;
  status: "success" | "failure";
}

/**
 * Records an auth event to session_audit_log.
 * Fails silently so callers are never blocked by logging errors.
 * Requires the session_audit_log table to exist in Supabase — see the
 * DB migration in the plan for the CREATE TABLE statement.
 */
export async function logSessionEvent(
  params: SessionEventParams
): Promise<void> {
  try {
    const supabase = await createClient();
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
      console.error("auditLog:insert:error", error.message);
    }
  } catch (err) {
    console.error(
      "auditLog:exception",
      err instanceof Error ? err.message : String(err)
    );
  }
}
