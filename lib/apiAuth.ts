import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Returns 401 if no valid session. Passes userId, email, and a server-side
 * Supabase client to the handler so it can skip redundant auth checks.
 * The route context (e.g. `{ params }` on dynamic routes) is forwarded as-is.
 */
export function requireAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      const supabase = await createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      return handler(req, {
        userId: user.id,
        email: user.email ?? "",
        supabase,
      }, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("requireAuth:error", message);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
