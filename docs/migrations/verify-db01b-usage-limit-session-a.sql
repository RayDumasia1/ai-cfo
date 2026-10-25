-- PREVIEW ONLY. DB-01B last-slot concurrency test, session A.
-- Apply the atomic usage migration and run its sequential verifier first.
-- Replace both NULLs, set preview_confirmed := true, and use postgres.
-- This test commits one temporary 2099 fixture so session B can observe it;
-- session B deletes it. A cleanup statement is included below for interruptions.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  result jsonb;
  n integer;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usage_tracking WHERE user_id=account_a
      AND metric='ask_cfo_questions' AND period_start='2099-01-01T00:00:00Z') THEN
    RAISE EXCEPTION 'Remove the prior DB-01B 2099 fixture before retrying';
  END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  FOR n IN 1..20 LOOP
    result := public.consume_usage(account_a,'ask_cfo_questions',
      '2099-01-01T00:00:00Z','2099-02-01T00:00:00Z',20,false);
    ASSERT result->>'allowed' = 'true' AND (result->>'count')::integer = n;
  END LOOP;
  EXECUTE 'RESET ROLE';
END;
$$;

SELECT 'Last slot consumed but uncommitted; run session B now.' AS instruction;
SELECT pg_sleep(15);
COMMIT;

-- Cleanup if session B is interrupted after this transaction commits:
-- DELETE FROM public.usage_tracking
-- WHERE user_id='<account-a-uuid>'::uuid AND metric='ask_cfo_questions'
--   AND period_start='2099-01-01T00:00:00Z';

