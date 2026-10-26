import { NextRequest, NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVerifiedEmail, emailVerificationRequired } from "./authPolicy";

export interface AuthedSession {
  userId: string;
  email: string;
  supabase: SupabaseClient;
}

type AuthedHandler<Ctx> = (
  req: NextRequest,
  session: AuthedSession,
  ctx: Ctx
) => Promise<Response>;

/**
 * Wraps an API route handler with session validation.
 * Returns 401 if no valid session, 403 if email verification is incomplete.
 * Passes userId, email, and a server-side
 * Supabase client to the handler so it can skip redundant auth checks.
 * The route context (e.g. `{ params }` on dynamic routes) is forwarded as-is.
 * Unexpected failures return safe JSON; framework control-flow exceptions propagate.
 */
export function requireAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    let phase: "authentication" | "handler" = "authentication";
    try {
      const supabase = await createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!hasVerifiedEmail(user)) return emailVerificationRequired();

      phase = "handler";
      // Await here so rejected handler promises enter this error boundary.
      return await handler(req, {
        userId: user.id,
        email: user.email ?? "",
        supabase,
      }, ctx);
    } catch (err) {
      unstable_rethrow(err);
      const requestId = crypto.randomUUID();
      const failure = err && typeof err === "object" ? err as Record<string, unknown> : null;
      console.error("requireAuth:error", {
        requestId,
        phase,
        method: req.method,
        path: req.nextUrl.pathname,
        name: err instanceof Error ? err.name : undefined,
        code: typeof failure?.code === "string" ? failure.code : undefined,
        hint: typeof failure?.hint === "string" ? failure.hint : undefined,
      });
      return NextResponse.json(
        { error: "Internal server error", requestId },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
  };
}
