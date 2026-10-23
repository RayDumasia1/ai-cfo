import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/utils/supabase/service";
import { getClaimedFoundingMemberCount, getAvailableFoundingMemberNumber } from "@/lib/db";
import { FOUNDING_MEMBER_SPOTS } from "@/lib/launchConfig";

export interface FoundingMemberAvailability {
  total: number;
  claimed: number;
  remaining: number;
  soldOut: boolean;
}

/**
 * Single source of truth for Founding Member spot availability. Used by the
 * checkout gate, /welcome, the webhook's member numbering, and the public
 * marketing counter so they can never disagree. Throws on query failure —
 * callers must not fall back to a guessed count.
 */
export async function getFoundingMemberAvailability(
  client: SupabaseClient = createServiceClient()
): Promise<FoundingMemberAvailability> {
  const total = FOUNDING_MEMBER_SPOTS;
  const claimed = await getClaimedFoundingMemberCount(client);
  const remaining = Math.max(0, total - claimed);
  return { total, claimed, remaining, soldOut: remaining === 0 };
}

const UNIQUE_VIOLATION = "23505";
const FOUNDING_NUMBER_ATTEMPTS = 3;

/**
 * Writes a new Founding Member's row with the lowest available customer number in #1-#25.
 * The unique index on founding_member_number rejects a number taken by a
 * concurrent checkout; on that conflict, recompute and retry. Exhaustion or
 * database failure must never grant an untracked membership.
 */
export async function upsertNewFoundingMember(
  row: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient
): Promise<{ upsertError: { code?: string } | null; memberNumber: number | null }> {
  for (let attempt = 1; attempt <= FOUNDING_NUMBER_ATTEMPTS; attempt++) {
    let nextNumber: number | null;
    try {
      nextNumber = await getAvailableFoundingMemberNumber(supabase);
      if (nextNumber === null) {
        return { upsertError: { code: "P0002" }, memberNumber: null };
      }
    } catch (err) {
      console.error("webhook:founding_member:numbering:error", { userId, err });
      break;
    }

    const { error } = await supabase
      .from("subscriptions")
      .upsert({ ...row, founding_member_number: nextNumber }, { onConflict: "user_id" });
    if (!error) return { upsertError: null, memberNumber: nextNumber };
    if (error.code !== UNIQUE_VIOLATION) {
      console.error("webhook:checkoutCompleted:upsert:error", error);
      return { upsertError: error, memberNumber: null };
    }
    console.warn("webhook:founding_member:numberConflict", { userId, nextNumber, attempt });
  }

  console.error("webhook:founding_member:retry_required", { userId });
  return { upsertError: { code: "40001" }, memberNumber: null };
}
