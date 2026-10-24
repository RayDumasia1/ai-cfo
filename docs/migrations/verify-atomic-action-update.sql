-- PREVIEW ONLY. NEVER run in production, even on production test accounts.
-- Run after the action-capacity and atomic-action-update migrations.
-- Fill in TWO dedicated preview UUIDs and set preview_confirmed := true.
-- Run the COMPLETE script through ROLLBACK. It temporarily changes account A's
-- tier and creates fixtures for both accounts; all changes are rolled back.
-- After any failure, run ROLLBACK in the same session before retrying.
-- This is a sequential rollback/RLS verifier, not a concurrent-session test.
BEGIN ISOLATION LEVEL READ COMMITTED;
DO $$
DECLARE
  account_a uuid := NULL;
  account_b uuid := NULL;
  preview_confirmed boolean := false;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW, supply two distinct dedicated preview-account UUIDs, and run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  PERFORM set_config('elidan.action_update_a', account_a::text, true);
  PERFORM set_config('elidan.action_update_b', account_b::text, true);
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.update_action_with_audit(uuid,uuid,jsonb,text)'::regprocedure),
    'RPC must use caller permissions';
  ASSERT has_function_privilege('authenticated', 'public.update_action_with_audit(uuid,uuid,jsonb,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.update_action_with_audit(uuid,uuid,jsonb,text)', 'EXECUTE');
END $$;

CREATE FUNCTION pg_temp.action_update_snapshot(account_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'actions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.actions t WHERE user_id = account_id),
    'audit', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.action_audit_log t WHERE user_id = account_id),
    'subscription', (SELECT to_jsonb(t) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;
CREATE FUNCTION pg_temp.force_action_update_audit_failure() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('elidan.action_update_fail', true) = 'on' THEN
    IF NEW.action_id = current_setting('elidan.action_update_fixture', true)::uuid THEN
      RAISE EXCEPTION 'Forced atomic action audit failure';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_atomic_action_audit_failure BEFORE INSERT ON public.action_audit_log
  FOR EACH ROW EXECUTE FUNCTION pg_temp.force_action_update_audit_failure();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.action_update_a')::uuid;
  account_b uuid := current_setting('elidan.action_update_b')::uuid;
  action_a uuid;
  action_b uuid;
  before_b jsonb;
  before_subscription jsonb;
  before_failure jsonb;
  result jsonb;
  invalid_payload jsonb;
  denied boolean;
  audit_baseline integer;
BEGIN
  INSERT INTO public.subscriptions(user_id) VALUES(account_a) ON CONFLICT(user_id) DO NOTHING;
  before_subscription := (pg_temp.action_update_snapshot(account_a)->'subscription') - ARRAY['feature_tier','updated_at'];
  UPDATE public.subscriptions SET feature_tier = 'growth' WHERE user_id = account_a;
  INSERT INTO public.actions(user_id,name,goal_type,status,description)
    VALUES(account_a,'Atomic action update fixture','risk_mitigation','not_started','Original description') RETURNING id INTO action_a;
  INSERT INTO public.actions(user_id,name,goal_type,status)
    VALUES(account_b,'Other-account action fixture','risk_mitigation','completed') RETURNING id INTO action_b;
  before_b := pg_temp.action_update_snapshot(account_b);
  SELECT count(*) INTO audit_baseline FROM public.action_audit_log WHERE action_id = action_a;
  PERFORM set_config('elidan.action_update_fixture', action_a::text, true);
  PERFORM set_config('elidan.action_update_fail', 'off', true);
  PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_a,'role','authenticated')::text, true);

  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.update_action_with_audit(account_a,action_a,'{"status":"in_progress"}', 'Verified transition');
  ASSERT result->>'id' = action_a::text AND result->>'user_id' = account_a::text AND result->>'status' = 'in_progress';
  ASSERT (SELECT count(*) FROM public.action_audit_log WHERE action_id = action_a) = audit_baseline + 1,
    'Expected exactly one audit entry; inspect any existing automatic audit triggers if this fails';
  ASSERT EXISTS (SELECT 1 FROM public.action_audit_log WHERE action_id = action_a AND user_id = account_a
    AND old_status = 'not_started' AND new_status = 'in_progress' AND note = 'Verified transition');
  result := public.update_action_with_audit(account_a,action_a,'{"status":"in_progress"}');
  ASSERT (SELECT count(*) FROM public.action_audit_log WHERE action_id = action_a) = audit_baseline + 1, 'Same-status retry duplicated history';
  result := public.update_action_with_audit(account_a,action_a,
    '{"description":null,"goal_value":42,"due_date":null,"actual_impact_notes":"Checked"}');
  ASSERT result->'description' = 'null'::jsonb AND (result->>'goal_value')::numeric = 42 AND result->>'actual_impact_notes' = 'Checked';
  ASSERT (SELECT count(*) FROM public.action_audit_log WHERE action_id = action_a) = audit_baseline + 1, 'Non-status edit added status history';
  EXECUTE 'RESET ROLE';

  -- Fail at the final audit insert, after UPDATE/timestamp/capacity triggers ran.
  before_failure := pg_temp.action_update_snapshot(account_a);
  PERFORM set_config('elidan.action_update_fail', 'on', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN
    result := public.update_action_with_audit(account_a,action_a,
      '{"status":"completed","name":"Must roll back","actual_impact":100}');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Forced atomic action audit failure' THEN RAISE; END IF;
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied, 'Late audit failure did not fire';
  ASSERT pg_temp.action_update_snapshot(account_a) = before_failure, 'Audit failure left partial action/history changes';
  PERFORM set_config('elidan.action_update_fail', 'off', true);

  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.update_action_with_audit(account_a,action_a,'{"status":"completed"}');
  ASSERT result->>'status' = 'completed';
  ASSERT (SELECT completed_at IS NOT NULL FROM public.actions WHERE id = action_a), 'Completion timestamp trigger was not preserved';
  ASSERT (SELECT count(*) FROM public.action_audit_log WHERE action_id = action_a) = audit_baseline + 2;
  ASSERT EXISTS (SELECT 1 FROM public.action_audit_log WHERE action_id = action_a
    AND old_status = 'in_progress' AND new_status = 'completed');
  result := public.update_action_with_audit(account_a,action_a,'{"status":"completed"}');
  ASSERT (SELECT count(*) FROM public.action_audit_log WHERE action_id = action_a) = audit_baseline + 2;

  -- Both spoofed ownership and another account's action must be inaccessible.
  denied := false;
  BEGIN
    result := public.update_action_with_audit(account_b,action_b,'{"status":"in_progress"}');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'RPC accepted another account identity';
  denied := false;
  BEGIN
    result := public.update_action_with_audit(account_a,action_b,'{"status":"in_progress"}');
  EXCEPTION WHEN no_data_found THEN denied := true;
  END;
  ASSERT denied, 'RPC exposed another account action';

  FOR invalid_payload IN SELECT value FROM jsonb_array_elements(
    '[null,[],{}, {"user_id":"other"}, {"id":"other"}, {"completed_at":null},
      {"name":null}, {"name":""}, {"status":null}, {"status":"invalid"},
      {"goal_value":"Infinity"}, {"description":12}, {"goal_type":null}, {"due_date":"invalid"}]'::jsonb
  ) LOOP
    denied := false;
    BEGIN
      result := public.update_action_with_audit(account_a,action_a,invalid_payload);
    EXCEPTION WHEN invalid_parameter_value THEN denied := true;
    END;
    ASSERT denied, 'RPC accepted an invalid update payload';
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- No identity: even a role with EXECUTE cannot choose an account.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN
    result := public.update_action_with_audit(account_a,action_a,'{"status":"in_progress"}');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'Missing Auth identity was accepted';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', account_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',account_a,'role','authenticated')::text, true);

  -- Capacity rejection must still roll back status/history together.
  UPDATE public.subscriptions SET feature_tier = 'suspended' WHERE user_id = account_a;
  before_failure := pg_temp.action_update_snapshot(account_a);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN
    result := public.update_action_with_audit(account_a,action_a,'{"status":"in_progress"}');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'action_limit_reached' THEN RAISE; END IF;
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied, 'Atomic update bypassed the capacity guard';
  ASSERT pg_temp.action_update_snapshot(account_a) = before_failure, 'Capacity rejection left partial changes';
  ASSERT pg_temp.action_update_snapshot(account_b) = before_b, 'Another account changed';
  ASSERT (pg_temp.action_update_snapshot(account_a)->'subscription') - ARRAY['feature_tier','updated_at']
    = before_subscription, 'Billing or Founding identity changed';
END $$;
ROLLBACK;
