-- PREVIEW ONLY. Run in a separate SQL Editor window while session A is sleeping.
-- Replace both NULLs, set preview_confirmed := true, and use postgres.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  result jsonb;
  other_before jsonb;
  other_after jsonb;
  test_email constant text := 'email01a-concurrency@example.invalid';
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.email,n.feature) INTO other_before
    FROM public.notify_me n WHERE n.user_id=account_b;
  PERFORM set_config('statement_timeout','30s',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.register_feature_notification(test_email,'tier_growth',account_a);
  EXECUTE 'RESET ROLE';
  ASSERT result @> '{"inserted":false,"outbox":[]}'::jsonb,
    'The concurrent duplicate created registration or email work';
  ASSERT (SELECT count(*) FROM public.notify_me WHERE email=test_email AND feature='tier_growth')=1;
  ASSERT (SELECT count(*) FROM public.email_outbox WHERE email=test_email AND feature='tier_growth')=2;
  ASSERT (SELECT count(DISTINCT message_type) FROM public.email_outbox WHERE email=test_email AND feature='tier_growth')=2;
  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.email,n.feature) INTO other_after
    FROM public.notify_me n WHERE n.user_id=account_b;
  ASSERT other_after IS NOT DISTINCT FROM other_before, 'The unrelated account changed';
  DELETE FROM public.email_outbox WHERE email=test_email AND feature='tier_growth';
  DELETE FROM public.notify_me WHERE email=test_email AND feature='tier_growth';
END;
$$;

COMMIT;
SELECT 'PASS: concurrent feature registration created one registration and two messages.' AS result;
