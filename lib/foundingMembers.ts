import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/utils/supabase/service";
import { getClaimedFoundingMemberCount, getMaxFoundingMemberNumber } from "@/lib/db";
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
 * Writes a new Founding Member's row with the next member number (max + 1).
 * The unique index on founding_member_number rejects a number taken by a
 * concurrent checkout; on that conflict, recompute and retry. If a number still
 * can't be assigned, write the row without one so the paying customer keeps
 * access, and log for manual fix-up — never guess a number.
 */
export async function upsertNewFoundingMember(
  row: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient
): Promise<{ upsertError: { code?: string } | null; memberNumber: number | null }> {
  for (let attempt = 1; attempt <= FOUNDING_NUMBER_ATTEMPTS; attempt++) {
    let nextNumber: number;
    try {
      nextNumber = (await getMaxFoundingMemberNumber(supabase)) + 1;
      const { claimed, total } = await getFoundingMemberAvailability(supabase);
      if (claimed + 1 > total) {
        console.warn(
          `webhook:founding_member:cap_exceeded claimed=${claimed + 1} number=${nextNumber}`
        );
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

  console.error("webhook:founding_member:unnumbered — assign manually", { userId });
  const { error } = await supabase
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) console.error("webhook:checkoutCompleted:upsert:error", error);
  return { upsertError: error, memberNumber: null };
}
