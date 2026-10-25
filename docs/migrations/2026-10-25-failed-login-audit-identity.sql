-- Permit server-recorded failed-login events, which have no authenticated user UUID.
-- Browser inserts remain governed by session_audit_insert_own and cannot use NULL.
BEGIN;

ALTER TABLE public.session_audit_log
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.session_audit_log
  DROP CONSTRAINT IF EXISTS session_audit_user_identity_check;

ALTER TABLE public.session_audit_log
  ADD CONSTRAINT session_audit_user_identity_check
  CHECK (action = 'failed_login' OR user_id IS NOT NULL);

COMMIT;
