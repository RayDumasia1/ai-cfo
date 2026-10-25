-- PREVIEW ONLY. Run while verify-db01a-subscription-action-lock-session-a.sql is sleeping.
-- Replace both NULLs, set preview_confirmed := true, and run as postgres.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL; -- same locked account used in session A
  account_b uuid := NULL; -- distinct preview account used to verify isolation
  account_b_before jsonb;
  account_b_after jsonb;
  timed_out boolean;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.actions'::regclass
    AND tgname = 'enforce_action_capacity' AND tgenabled = 'O' AND NOT tgisinternal),
    'The action-capacity trigger is missing';

  SELECT jsonb_build_object(
    'subscription',(SELECT to_jsonb(t) FROM public.subscriptions t WHERE t.user_id = account_b),
    'actions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.actions t WHERE t.user_id = account_b),
    'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.action_audit_log t WHERE t.user_id = account_b)
  ) INTO account_b_before;

  PERFORM set_config('lock_timeout','2s',true);

  timed_out := false;
  BEGIN
    UPDATE public.subscriptions SET status = status WHERE user_id = account_a;
  EXCEPTION WHEN lock_not_available THEN timed_out := true;
  END;
  ASSERT timed_out, 'A concurrent subscription write did not wait on the subscription row lock';

  timed_out := false;
  BEGIN
    INSERT INTO public.actions(user_id,name,goal_type,status)
      VALUES(account_a,'DB-01A contention probe','risk_mitigation','not_started');
  EXCEPTION WHEN lock_not_available THEN timed_out := true;
  END;
  ASSERT timed_out, 'Action-slot acquisition did not wait on the subscription row lock';
  ASSERT NOT EXISTS (SELECT 1 FROM public.actions
    WHERE user_id = account_a AND name = 'DB-01A contention probe'),
    'The timed-out action insert left a row behind';

  SELECT jsonb_build_object(
    'subscription',(SELECT to_jsonb(t) FROM public.subscriptions t WHERE t.user_id = account_b),
    'actions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.actions t WHERE t.user_id = account_b),
    'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.action_audit_log t WHERE t.user_id = account_b)
  ) INTO account_b_after;
  ASSERT account_b_after = account_b_before, 'The unrelated preview account changed';
END;
$$;

SELECT 'PASS: subscription writes and action-slot acquisition share the subscription row lock.' AS result;
ROLLBACK;

