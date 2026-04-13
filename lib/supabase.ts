/**
 * Supabase client module.
 *
 * `supabase`           — browser singleton; import in "use client" components and lib/db.ts
 * `createServerClient` — factory for Server Components / Route Handlers (requires cookies context)
 *
 * Note: @supabase/auth-helpers-nextjs is deprecated. This project uses the
 * modern @supabase/ssr package instead — it ships both browser and server
 * client helpers and is maintained by the Supabase team.
 */

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// One shared instance for all client-side usage.
// createBrowserClient handles its own singleton logic internally.
export const supabase = createBrowserClient(url, key);

// Server client factory — wraps utils/supabase/server.ts.
// Usage in a Server Component:
//   const cookieStore = await cookies();
//   const db = createServerClient(cookieStore);
//   const { data } = await db.from("financial_months").select();
export { createClient as createServerClient } from "@/utils/supabase/server";
