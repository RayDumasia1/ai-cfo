-- PREVIEW ONLY. Never run in production.
-- Replace both UUIDs, confirm preview, and run as postgres.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  test_email text := 'email01a-' || txid_current() || '@example.invalid';
  first_result jsonb;
  duplicate_result jsonb;
  other_before jsonb;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed OR account_a IS NULL OR account_b IS NULL OR account_a=account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b))<>2 THEN RAISE EXCEPTION 'Both preview accounts must exist'; END IF;
  ASSERT has_function_privilege('service_role','public.register_feature_notification(text,text,uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.register_feature_notification(text,text,uuid)','EXECUTE');
  ASSERT NOT has_table_privilege('authenticated','public.email_outbox','SELECT');
  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.email,n.feature) INTO other_before FROM public.notify_me n WHERE n.user_id=account_b;
  EXECUTE 'SET LOCAL ROLE service_role';
  first_result:=public.register_feature_notification(test_email,'tier_growth',account_a);
  duplicate_result:=public.register_feature_notification(test_email,'tier_growth',account_a);
  EXECUTE 'RESET ROLE';
  ASSERT first_result->>'inserted'='true' AND jsonb_array_length(first_result->'outbox')=2;
  ASSERT duplicate_result @> '{"inserted":false,"outbox":[]}'::jsonb;
  ASSERT (SELECT count(*) FROM public.notify_me WHERE email=test_email AND feature='tier_growth')=1;
  ASSERT (SELECT count(*) FROM public.email_outbox WHERE email=test_email AND feature='tier_growth')=2;
  ASSERT (SELECT count(DISTINCT message_type) FROM public.email_outbox WHERE email=test_email AND feature='tier_growth')=2;
  ASSERT (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.email,n.feature) FROM public.notify_me n WHERE n.user_id=account_b) IS NOT DISTINCT FROM other_before;
END $$;
ROLLBACK;
