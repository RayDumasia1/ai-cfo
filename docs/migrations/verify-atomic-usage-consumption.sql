-- PREVIEW ONLY. Never run in production.
-- Apply 2026-10-25-atomic-usage-consumption.sql first.
-- Replace both NULLs, set preview_confirmed := true, and run the whole script as postgres.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  ASSERT has_function_privilege('service_role',
    'public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('anon',
    'public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated',
    'public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated',
    'public.increment_usage(uuid,text,timestamptz,timestamptz,integer)','EXECUTE');
  PERFORM set_config('elidan.db01b_a',account_a::text,true);
  PERFORM set_config('elidan.db01b_b',account_b::text,true);
END;
$$;

DO $$
DECLARE
  account_a uuid := current_setting('elidan.db01b_a')::uuid;
  account_b uuid := current_setting('elidan.db01b_b')::uuid;
  v_period_start timestamptz := '2099-01-01T00:00:00Z';
  v_period_end timestamptz := '2099-02-01T00:00:00Z';
  other_before jsonb;
  result jsonb;
  denied boolean;
BEGIN
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO other_before
    FROM public.usage_tracking t WHERE t.user_id = account_b;
  DELETE FROM public.usage_tracking t WHERE t.user_id = account_a AND t.period_start = v_period_start;

  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.consume_usage(account_a,'ask_cfo_questions',v_period_start,v_period_end,2,false);
  ASSERT result @> '{"allowed":true,"throttled":false,"count":1,"usage_limit":2}'::jsonb;
  result := public.consume_usage(account_a,'ask_cfo_questions',v_period_start,v_period_end,2,false);
  ASSERT result @> '{"allowed":true,"throttled":false,"count":2,"usage_limit":2}'::jsonb;
  result := public.consume_usage(account_a,'ask_cfo_questions',v_period_start,v_period_end,2,false);
  ASSERT result @> '{"allowed":false,"throttled":false,"count":2,"usage_limit":2}'::jsonb;
  ASSERT (SELECT count FROM public.usage_tracking WHERE user_id=account_a
    AND metric='ask_cfo_questions' AND usage_tracking.period_start=v_period_start) = 2;

  result := public.consume_usage(account_a,'ask_cfo_questions',v_period_start,v_period_end,2,true);
  ASSERT result @> '{"allowed":true,"throttled":true,"count":3,"usage_limit":2}'::jsonb;

  result := public.consume_usage(account_a,'ai_insight_runs',v_period_start,v_period_end,1,false);
  ASSERT result @> '{"allowed":true,"throttled":false,"count":1,"usage_limit":1}'::jsonb;
  result := public.consume_usage(account_a,'ai_insight_runs',v_period_start,v_period_end,1,false);
  ASSERT result @> '{"allowed":false,"throttled":false,"count":1,"usage_limit":1}'::jsonb;

  denied := false;
  BEGIN
    PERFORM public.consume_usage(account_a,'unknown',v_period_start,v_period_end,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN denied := true;
  END;
  ASSERT denied, 'Unknown metric was accepted';
  denied := false;
  BEGIN
    PERFORM public.consume_usage(account_a,'ask_cfo_questions',v_period_end,v_period_start,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN denied := true;
  END;
  ASSERT denied, 'Invalid period was accepted';
  EXECUTE 'RESET ROLE';

  ASSERT (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)
    FROM public.usage_tracking t WHERE t.user_id = account_b) IS NOT DISTINCT FROM other_before,
    'The unrelated account changed';
END;
$$;

ROLLBACK;

