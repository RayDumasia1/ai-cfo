-- PREVIEW ONLY. NEVER run in production, even on production test accounts.
-- Run AFTER 2026-10-23-action-capacity-guard.sql.
-- Replace the two NULLs and set preview_confirmed := true ONLY in preview.
-- Uses dedicated accounts, temporarily deletes account A's actions and changes
-- its feature tier, then rolls EVERYTHING back. Run the WHOLE script.
-- If an assertion fails, run ROLLBACK in the same session before retrying.
-- Sequential transaction/RLS checks only; this is NOT a concurrency test.
BEGIN ISOLATION LEVEL READ COMMITTED;
DO $$
DECLARE
  account_a uuid := NULL; -- first dedicated PREVIEW account UUID
  account_b uuid := NULL; -- second dedicated PREVIEW account UUID
  preview_confirmed boolean := false;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  PERFORM set_config('elidan.capacity_account_a', account_a::text, true);
  PERFORM set_config('elidan.capacity_account_b', account_b::text, true);
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.actions'::regclass
    AND tgname = 'enforce_action_capacity' AND tgenabled = 'O' AND NOT tgisinternal);
  ASSERT (SELECT prosecdef AND provolatile = 'v' AND proowner = 'postgres'::regrole
    FROM pg_proc WHERE oid = 'public.enforce_action_capacity()'::regprocedure);
  ASSERT NOT has_function_privilege('authenticated', 'public.enforce_action_capacity()', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.enforce_action_capacity()', 'EXECUTE');
END $$;

CREATE FUNCTION pg_temp.capacity_snapshot(account_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'actions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.actions t WHERE user_id = account_id),
    'audit', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.action_audit_log t WHERE user_id = account_id),
    'subscription', (SELECT to_jsonb(t) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

DO $$
DECLARE
  account_a uuid := current_setting('elidan.capacity_account_a')::uuid;
  account_b uuid := current_setting('elidan.capacity_account_b')::uuid;
  before_b jsonb := pg_temp.capacity_snapshot(account_b);
  before_subscription jsonb;
  before_rejection jsonb;
  v_tier text;
  v_limit integer;
  v_completed_id uuid;
  v_active_id uuid;
  v_denied boolean;
  v_detail text;
BEGIN
  INSERT INTO public.subscriptions(user_id) VALUES(account_a) ON CONFLICT(user_id) DO NOTHING;
  before_subscription := (pg_temp.capacity_snapshot(account_a)->'subscription')
    - ARRAY['feature_tier','updated_at'];

  FOREACH v_tier IN ARRAY ARRAY['suspended','starter','core','growth','advisory'] LOOP
    DELETE FROM public.actions WHERE user_id = account_a;
    UPDATE public.subscriptions SET feature_tier = v_tier WHERE user_id = account_a;
    v_limit := CASE v_tier WHEN 'suspended' THEN 0 WHEN 'starter' THEN 10 WHEN 'core' THEN 50 ELSE 51 END;
    INSERT INTO public.actions(user_id, name, goal_type, status)
      SELECT account_a, 'Capacity verification ' || n, 'risk_mitigation', 'not_started'
      FROM generate_series(1, v_limit) n;
    INSERT INTO public.actions(user_id, name, goal_type, status)
      VALUES(account_a, 'Capacity completed fixture', 'risk_mitigation', 'completed') RETURNING id INTO v_completed_id;
    ASSERT (SELECT count(*) FROM public.actions WHERE user_id = account_a AND status <> 'completed') = v_limit;
    before_rejection := pg_temp.capacity_snapshot(account_a);

    -- RLS-authorized writes still invoke the SECURITY DEFINER counting guard.
    PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', account_a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_denied := false;
    BEGIN
      INSERT INTO public.actions(user_id, name, goal_type, status)
        VALUES(account_a, 'Capacity extra fixture', 'risk_mitigation', 'in_progress');
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      IF SQLERRM <> 'action_limit_reached' OR v_detail <> v_limit::text THEN RAISE; END IF;
      v_denied := true;
    END;
    EXECUTE 'RESET ROLE';
    IF v_tier IN ('growth','advisory') THEN
      ASSERT NOT v_denied, 'Unlimited tier rejected an active action';
      ASSERT (SELECT count(*) FROM public.actions WHERE user_id = account_a AND status <> 'completed') = 52;
    ELSE
      ASSERT v_denied, 'Limited tier accepted an extra active action';
      ASSERT pg_temp.capacity_snapshot(account_a) = before_rejection, 'Rejected insert left partial changes';
      v_denied := false;
      BEGIN
        UPDATE public.actions SET status = 'in_progress' WHERE id = v_completed_id AND user_id = account_a;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'action_limit_reached' THEN RAISE; END IF;
        v_denied := true;
      END;
      ASSERT v_denied, 'Reopening exceeded capacity';
      ASSERT pg_temp.capacity_snapshot(account_a) = before_rejection, 'Rejected reopen left partial changes';
    END IF;
  END LOOP;

  -- Grandfather existing actions after a downgrade; allow edits/completion.
  UPDATE public.subscriptions SET feature_tier = 'suspended' WHERE user_id = account_a;
  SELECT id INTO STRICT v_active_id FROM public.actions WHERE user_id = account_a AND status <> 'completed' LIMIT 1;
  UPDATE public.actions SET name = 'Capacity edited after downgrade' WHERE id = v_active_id;
  UPDATE public.actions SET status = 'in_progress' WHERE id = v_active_id;
  UPDATE public.actions SET status = 'completed' WHERE id = v_active_id;
  ASSERT (SELECT status FROM public.actions WHERE id = v_active_id) = 'completed';

  -- One remaining slot: a two-row statement must roll back as a whole.
  DELETE FROM public.actions WHERE user_id = account_a;
  UPDATE public.subscriptions SET feature_tier = 'starter' WHERE user_id = account_a;
  INSERT INTO public.actions(user_id, name, goal_type, status)
    SELECT account_a, 'Capacity batch fixture ' || n, 'risk_mitigation', 'not_started' FROM generate_series(1,9) n;
  before_rejection := pg_temp.capacity_snapshot(account_a);
  v_denied := false;
  BEGIN
    INSERT INTO public.actions(user_id, name, goal_type, status)
      SELECT account_a, 'Capacity batch overflow ' || n, 'risk_mitigation', 'not_started' FROM generate_series(1,2) n;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'action_limit_reached' THEN RAISE; END IF;
    v_denied := true;
  END;
  ASSERT v_denied, 'Multi-row statement exceeded capacity';
  ASSERT pg_temp.capacity_snapshot(account_a) = before_rejection, 'Multi-row failure left partial changes';
  INSERT INTO public.actions(user_id, name, goal_type, status)
    VALUES(account_a, 'Capacity exact final slot', 'risk_mitigation', 'not_started') RETURNING id INTO v_active_id;
  INSERT INTO public.actions(user_id, name, goal_type, status)
    VALUES(account_a, 'Capacity reopening fixture', 'risk_mitigation', 'completed') RETURNING id INTO v_completed_id;
  UPDATE public.actions SET status = 'completed' WHERE id = v_active_id;
  UPDATE public.actions SET status = 'in_progress' WHERE id = v_completed_id;
  ASSERT (SELECT count(*) FROM public.actions WHERE user_id = account_a AND status <> 'completed') = 10;

  -- The guard must not grant cross-account writes through its definer rights.
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_denied := false;
  BEGIN
    INSERT INTO public.actions(user_id, name, goal_type, status)
      VALUES(account_b, 'Must be denied by RLS', 'risk_mitigation', 'completed');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT v_denied, 'Cross-account insert was not denied by RLS';
  ASSERT pg_temp.capacity_snapshot(account_b) = before_b, 'Another account changed';
  ASSERT (pg_temp.capacity_snapshot(account_a)->'subscription') - ARRAY['feature_tier','updated_at']
    = before_subscription, 'Verification changed billing or Founding identity';
END $$;
ROLLBACK;
