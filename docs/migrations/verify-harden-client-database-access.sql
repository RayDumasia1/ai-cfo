-- PREVIEW ONLY. Run after 2026-10-25-harden-client-database-access.sql.
-- Replace both UUIDs with distinct dedicated preview accounts and confirm preview.
-- All row changes are rolled back. Run the whole script as postgres.
BEGIN;
DO $$
DECLARE
  account_a uuid := NULL;
  account_b uuid := NULL;
  preview_confirmed boolean := false;
  table_name text;
  denied boolean;
  before_subscription jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  PERFORM set_config('elidan.security_account_a', account_a::text, true);
  PERFORM set_config('elidan.security_account_b', account_b::text, true);

  FOREACH table_name IN ARRAY ARRAY[
    'action_audit_log','actions','business_profiles','cfo_calls','data_imports',
    'dismissed_alerts','expense_categories','financial_months','notify_me',
    'session_audit_log','subscriptions','usage_tracking'
  ] LOOP
    ASSERT NOT has_table_privilege('anon', format('public.%I', table_name), 'SELECT');
    ASSERT NOT has_table_privilege('anon', format('public.%I', table_name), 'INSERT');
    ASSERT NOT has_table_privilege('anon', format('public.%I', table_name), 'UPDATE');
    ASSERT NOT has_table_privilege('anon', format('public.%I', table_name), 'DELETE');
    ASSERT NOT has_table_privilege('anon', format('public.%I', table_name), 'TRUNCATE');
    ASSERT NOT has_table_privilege('authenticated', format('public.%I', table_name), 'TRUNCATE');
    ASSERT NOT has_table_privilege('authenticated', format('public.%I', table_name), 'TRIGGER');
    ASSERT NOT has_table_privilege('authenticated', format('public.%I', table_name), 'REFERENCES');
  END LOOP;

  ASSERT NOT has_table_privilege('authenticated', 'public.subscriptions', 'INSERT');
  ASSERT NOT has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.usage_tracking', 'INSERT');
  ASSERT NOT has_column_privilege('authenticated', 'public.usage_tracking', 'count', 'UPDATE');
  ASSERT has_column_privilege('authenticated', 'public.usage_tracking', 'warning_sent_at', 'UPDATE');

  ASSERT NOT has_function_privilege('anon', 'public.initialize_subscription()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.get_active_action_count(uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.increment_usage(uuid,text,timestamptz,timestamptz,integer)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.initialize_subscription()', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.get_active_action_count(uuid)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.increment_usage(uuid,text,timestamptz,timestamptz,integer)', 'EXECUTE');
  ASSERT (SELECT bool_and('search_path=""' = ANY(COALESCE(proconfig, ARRAY[]::text[])))
    FROM pg_proc WHERE oid IN ('public.initialize_subscription()'::regprocedure,
      'public.get_active_action_count(uuid)'::regprocedure,
      'public.increment_usage(uuid,text,timestamptz,timestamptz,integer)'::regprocedure));

  SELECT to_jsonb(s) INTO before_subscription FROM public.subscriptions s WHERE user_id = account_a;
  PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  PERFORM public.initialize_subscription();
  ASSERT (SELECT plan = 'starter' OR to_jsonb(s) = before_subscription
    FROM public.subscriptions s WHERE user_id = account_a);
  PERFORM public.get_active_action_count(account_a);

  denied := false;
  BEGIN PERFORM public.get_active_action_count(account_b);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Cross-account action count was exposed';

  denied := false;
  BEGIN PERFORM public.increment_usage(account_b, 'ask_cfo_questions',
    '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z', 20);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Cross-account usage increment was allowed';

  PERFORM public.increment_usage(account_a, 'ask_cfo_questions',
    '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z', 20);

  denied := false;
  BEGIN INSERT INTO public.subscriptions(user_id, plan, feature_tier, status)
    VALUES(account_b, 'advisory', 'advisory', 'active');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Authenticated role retained direct subscription insertion';

  denied := false;
  BEGIN UPDATE public.usage_tracking SET count = 0 WHERE user_id = account_a;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Authenticated role can rewrite usage counts';

  EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;
