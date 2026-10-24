-- Apply in PREVIEW first, as postgres. Installs a guard only; no row cleanup.
-- After preview verification, apply this migration (not the verifier) to production.
-- Uses default READ COMMITTED transactions; stronger-isolation slot acquisitions
-- fail closed rather than count from a transaction-wide stale snapshot.
BEGIN;

DO $$ BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS actions_active_capacity_user_idx ON public.actions(user_id)
  WHERE status <> 'completed';

CREATE OR REPLACE FUNCTION public.enforce_action_capacity()
RETURNS trigger
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tier text;
  v_limit integer;
  v_count bigint;
BEGIN
  -- Completion, deletion, and edits that take no new slot remain possible
  -- after a downgrade, including for accounts already above their new limit.
  IF NEW.status = 'completed' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'completed' AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
      RETURN NULL;
    END IF;
  END IF;

  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION 'Action slot acquisition requires READ COMMITTED' USING ERRCODE = '0A000';
  END IF;

  -- Every new active slot for this account locks the same existing row until
  -- commit/rollback. NO KEY UPDATE also coordinates with tier changes while
  -- remaining compatible with foreign-key KEY SHARE locks on this row.
  SELECT s.feature_tier INTO v_tier FROM public.subscriptions s
    WHERE s.user_id = NEW.user_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_tier IS NULL THEN
    RAISE EXCEPTION 'Action capacity could not be verified' USING ERRCODE = '55000';
  END IF;
  -- Keep aligned with USAGE_LIMITS in lib/featureGates.ts (covered by tests).
  CASE v_tier
    WHEN 'suspended' THEN v_limit := 0;
    WHEN 'starter' THEN v_limit := 10;
    WHEN 'core' THEN v_limit := 50;
    WHEN 'growth', 'advisory' THEN RETURN NULL;
    ELSE RAISE EXCEPTION 'Unknown action capacity tier' USING ERRCODE = '55000';
  END CASE;

  -- Separate query AFTER waiting for the lock: VOLATILE + READ COMMITTED sees
  -- the preceding holder's committed actions as well as this statement's rows.
  -- AFTER trigger: the new/reopened action is ALREADY included in this count.
  SELECT count(*) INTO v_count FROM public.actions a
    WHERE a.user_id = NEW.user_id AND a.status <> 'completed';
  IF v_count > v_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'action_limit_reached', DETAIL = v_limit::text;
  END IF;
  RETURN NULL;
END;
$$;

-- Direct execution is unnecessary: PostgreSQL invokes this only as a trigger.
ALTER FUNCTION public.enforce_action_capacity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_action_capacity() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS enforce_action_capacity ON public.actions;
CREATE TRIGGER enforce_action_capacity AFTER INSERT OR UPDATE ON public.actions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action_capacity();
COMMENT ON FUNCTION public.enforce_action_capacity()
  IS 'Atomic active-action capacity guard for INSERT/reopen/reassignment. Fixed tiers; no billing or identity mutations.';

COMMIT;
