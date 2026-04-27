"use client";

/**
 * Browser-side Supabase client factory.
 *
 * Call createClient() inside each client component that needs Supabase.
 * createBrowserClient handles singleton logic internally — repeated calls
 * with the same URL/key return the same underlying client instance.
 *
 * Import ONLY in "use client" components. For Server Components and Route
 * Handlers use @/lib/supabase/server instead.
 *
 * Security note: @supabase/ssr's createBrowserClient stores tokens in
 * cookies (not localStorage), which are refreshed server-side on every
 * request by proxy.ts. This keeps tokens out of localStorage where they
 * would persist indefinitely and be accessible to any script on the page.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
