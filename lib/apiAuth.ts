import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuthedSession {
  userId: string;
  email: string;
  supabase: SupabaseClient;
}

type AuthedHandler = (
  req: NextRequest,
  session: AuthedSession
) => Promise<Response>;

/**
 * Wraps an API route handler with session validation.
 * Returns 401 if no valid session. Passes userId, email, and a server-side
 * Supabase client to the handler so it can skip redundant auth checks.
 */
export function requireAuth(handler: AuthedHandler) {
  return async (req: NextRequest): Promise<Response> => {
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
      });
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
