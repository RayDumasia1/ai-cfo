import { createClient } from "@/utils/supabase/server";
import { getActions, getSubscription } from "@/lib/db";
import ActionsPageClient from "./ActionsPageClient";

export default async function ActionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [actions, subscription] = await Promise.all([
    // A failed load shows the empty state rather than an error page
    user
      ? getActions(user.id, {}, supabase).catch((err) => {
          // Supabase errors are plain objects, not Error instances — log message + code
          const { message, code } = (err ?? {}) as { message?: string; code?: string };
          console.error("actions:getActions:error", message ?? String(err), code ?? "");
          return [];
        })
      : [],
    user ? getSubscription(user.id, supabase) : null,
  ]);

  return (
    <ActionsPageClient
      featureTier={subscription?.feature_tier ?? "starter"}
      initialActions={actions}
    />
  );
}
