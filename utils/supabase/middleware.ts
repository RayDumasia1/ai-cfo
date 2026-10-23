import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = (request: NextRequest) => {
  // Accumulate cookie changes until Proxy has chosen its final response.
  const cookieResponse = NextResponse.next();

  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieResponse.cookies.set(name, value, options)
          );
        },
      },
    },
  );

  return {
    supabase,
    finishResponse(response?: Response) {
      // Build pass-through headers after getUser(), so downstream routes see
      // refreshed cookies rather than the tokens originally sent by the browser.
      const result = response
        ? response instanceof NextResponse
          ? response
          : new NextResponse(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
        : NextResponse.next({ request: { headers: request.headers } });
      const cookies = cookieResponse.cookies.getAll();
      cookies.forEach(cookie => result.cookies.set(cookie));
      if (cookies.length) {
        result.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
        result.headers.set("Pragma", "no-cache");
        result.headers.set("Expires", "0");
      }
      return result;
    },
  };
};
