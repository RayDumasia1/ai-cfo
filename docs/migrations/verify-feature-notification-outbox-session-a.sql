-- PREVIEW ONLY. EMAIL-01A concurrent-registration test, session A.
-- Apply the outbox migration and run its rollback verifier first.
-- Replace both NULLs, set preview_confirmed := true, and use postgres.
-- This test commits a temporary fixture so session B can inspect and delete it.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  result jsonb;
  test_email constant text := 'email01a-concurrency@example.invalid';
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notify_me WHERE email=test_email AND feature='tier_growth')
     OR EXISTS (SELECT 1 FROM public.email_outbox WHERE email=test_email AND feature='tier_growth') THEN
    RAISE EXCEPTION 'Remove the prior EMAIL-01A concurrency fixture before retrying';
  END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.register_feature_notification(test_email,'tier_growth',account_a);
  EXECUTE 'RESET ROLE';
  ASSERT result->>'inserted'='true' AND jsonb_array_length(result->'outbox')=2,
    'Session A did not create the expected registration and messages';
END;
$$;

SELECT 'Registration is uncommitted; run session B now.' AS instruction;
SELECT pg_sleep(15);
COMMIT;

-- Cleanup if session B is interrupted after this transaction commits:
-- DELETE FROM public.email_outbox WHERE email='email01a-concurrency@example.invalid' AND feature='tier_growth';
-- DELETE FROM public.notify_me WHERE email='email01a-concurrency@example.invalid' AND feature='tier_growth';
