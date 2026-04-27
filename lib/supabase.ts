/**
 * Browser-only Supabase singleton.
 *
 * For "use client" components and lib/db.ts (browser context).
 * New code can also import createClient from @/lib/supabase/browser.
 * For Server Components and Route Handlers use @/lib/supabase/server instead.
 */

import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);
