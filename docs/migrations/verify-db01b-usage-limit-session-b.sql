-- PREVIEW ONLY. Run in a separate browser while session A is sleeping.
-- Replace both NULLs, set preview_confirmed := true, and use postgres.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  other_before jsonb;
  other_after jsonb;
  result jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO other_before
    FROM public.usage_tracking t WHERE t.user_id=account_b;
  PERFORM set_config('statement_timeout','30s',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.consume_usage(account_a,'ask_cfo_questions',
    '2099-01-01T00:00:00Z','2099-02-01T00:00:00Z',20,false);
  EXECUTE 'RESET ROLE';
  ASSERT result @> '{"allowed":false,"throttled":false,"count":20,"usage_limit":20}'::jsonb,
    'The concurrent request crossed the hard limit';
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO other_after
    FROM public.usage_tracking t WHERE t.user_id=account_b;
  ASSERT other_after IS NOT DISTINCT FROM other_before, 'The unrelated account changed';
  DELETE FROM public.usage_tracking WHERE user_id=account_a
    AND metric='ask_cfo_questions' AND period_start='2099-01-01T00:00:00Z';
END;
$$;

COMMIT;
SELECT 'PASS: two concurrent hard-limit requests consumed only the final available unit.' AS result;

