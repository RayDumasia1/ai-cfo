/**
 * Server-side Supabase client factory.
 *
 * Import in Server Components and Route Handlers.
 * Re-exports from utils/supabase/server — single source of truth for the
 * cookie-aware SSR client implementation.
 *
 * Security note: This client reads and writes auth tokens via HTTP-only
 * cookies managed by Next.js cookies(). Tokens are never exposed to
 * client-side JavaScript through this path.
 */

export { createClient } from "@/utils/supabase/server";
