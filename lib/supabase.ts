/**
 * Browser-only Supabase singleton.
 *
 * Import this in "use client" components and lib/db.ts (browser context).
 * For Server Components and Route Handlers, import directly from
 * @/utils/supabase/server — never import the server client through this file.
 *
 * Note: @supabase/auth-helpers-nextjs is deprecated. This project uses the
 * modern @supabase/ssr package instead.
 */

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// One shared instance for all client-side usage.
// createBrowserClient handles its own singleton logic internally.
export const supabase = createBrowserClient(url, key);
