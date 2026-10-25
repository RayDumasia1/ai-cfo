-- PREVIEW ONLY. Session A of the DB-01A financial contention test.
-- Replace the NULL, set preview_confirmed := true, and run as postgres.
-- Start session B while this query displays/sleeps. This transaction always rolls back.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL; -- dedicated PREVIEW test-account UUID
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply a dedicated preview-account UUID; run as postgres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = account_a) THEN
    RAISE EXCEPTION 'The dedicated preview account does not exist';
  END IF;
  INSERT INTO public.business_profiles(user_id) VALUES(account_a) ON CONFLICT(user_id) DO NOTHING;
  PERFORM set_config('elidan.db01a_account', account_a::text, true);
END;
$$;

SELECT id FROM public.business_profiles
WHERE user_id = current_setting('elidan.db01a_account')::uuid
FOR UPDATE;

SELECT 'Financial lock held for 45 seconds; run the paired session-B script now.' AS instruction;
SELECT pg_sleep(45);
ROLLBACK;

