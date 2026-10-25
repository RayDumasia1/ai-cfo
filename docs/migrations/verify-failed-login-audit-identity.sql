-- PREVIEW ONLY. Run after 2026-10-25-failed-login-audit-identity.sql.
-- Change preview_confirmed to true and run the whole script as postgres.
-- All test rows are rolled back.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  denied boolean := false;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed THEN
    RAISE EXCEPTION 'Confirm PREVIEW and run as postgres';
  END IF;

  ASSERT has_table_privilege('service_role', 'public.session_audit_log', 'INSERT');
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'session_audit_log'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ), 'session_audit_log.user_id must allow failed-login NULL identity';
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.session_audit_log'::regclass
      AND conname = 'session_audit_user_identity_check'
      AND convalidated
  ), 'audit identity constraint is missing or unvalidated';

  EXECUTE 'SET LOCAL ROLE service_role';
  INSERT INTO public.session_audit_log (user_id, action, status, reason)
  VALUES (NULL, 'failed_login', 'failure', 'verification only');

  BEGIN
    INSERT INTO public.session_audit_log (user_id, action, status, reason)
    VALUES (NULL, 'logout', 'success', 'must be rejected');
  EXCEPTION WHEN check_violation THEN
    denied := true;
  END;
  ASSERT denied, 'A non-failed-login event accepted a NULL user identity';
  EXECUTE 'RESET ROLE';

  -- An authenticated browser role cannot exploit the nullable column because
  -- session_audit_insert_own requires auth.uid() = user_id.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub'),
    'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  denied := false;
  BEGIN
    INSERT INTO public.session_audit_log (user_id, action, status, reason)
    VALUES (NULL, 'failed_login', 'failure', 'must be rejected');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  ASSERT denied, 'Authenticated browser role inserted an anonymous audit event';
  EXECUTE 'RESET ROLE';
END $$;

ROLLBACK;
