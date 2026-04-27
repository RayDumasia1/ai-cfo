/**
 * Backward-compat shim — keeps existing `import { supabase } from "@/lib/supabase"`
 * imports working while new code migrates to createClient() from @/lib/supabase/browser.
 *
 * New code should prefer: import { createClient } from "@/lib/supabase/browser"
 */

import { createClient } from "./supabase/browser";

export const supabase = createClient();
