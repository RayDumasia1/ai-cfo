import type { SupabaseClient } from "@supabase/supabase-js";
import { getSubscription } from "./db";
import {
  hasFeature,
  isSuperuser,
  UPGRADE_MESSAGES,
  type Feature,
} from "./featureGates";

/**
 * Checks whether the authenticated user has access to a feature.
 * Returns null if access is granted, or a 402 Response if blocked.
 *
 * Usage in any API route:
 *   const gate = await checkFeatureGate(userId, email, 'ask_cfo', supabase)
 *   if (gate) return gate
 */
export async function checkFeatureGate(
  userId: string,
  userEmail: string,
  feature: Feature,
  serverClient: SupabaseClient
): Promise<Response | null> {
  if (isSuperuser(userEmail)) return null;

  const sub = await getSubscription(userId, serverClient);

  if (!hasFeature(sub.feature_tier, feature)) {
    return Response.json(
      {
        error: "Feature not available on your plan",
        upgrade_to: UPGRADE_MESSAGES[feature].upgrade_to,
        upgrade_message: UPGRADE_MESSAGES[feature].message,
        current_tier: sub.feature_tier,
      },
      { status: 402 }
    );
  }

  return null;
}
