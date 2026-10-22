-- Founding Member numbers must be unique.
-- Rejects a duplicate number from two concurrent checkouts; the Stripe webhook
-- (upsertNewFoundingMember in lib/foundingMembers.ts) catches the 23505 and
-- retries with the next number.
--
-- Applied in the Supabase SQL editor on 2026-10-21.

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_founding_member_number_key
  ON subscriptions (founding_member_number)
  WHERE founding_member_number IS NOT NULL;
