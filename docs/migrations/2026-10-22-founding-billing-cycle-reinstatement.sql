-- Apply in preview first, before deploying the restoration changes.
-- Customer identities survive cancellation/deletion. Only audited owner-level
-- corrections may release them. Test identities do not consume customer spots.
BEGIN;

-- Supersedes the 30-day policy migration, whether or not it was applied.
-- Deprecated rate_lost_at/restoration_deadline columns, if present, are unused.
-- No historical identities or issued spots are removed.

CREATE TABLE IF NOT EXISTS public.founding_member_spots (
  founding_member_number integer PRIMARY KEY CHECK (founding_member_number > 0),
  user_id uuid NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.founding_member_spots
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS founding_member_is_test boolean NOT NULL DEFAULT false;

-- Do not infer test status from an email or a number. Existing identities are
-- customers until an administrator explicitly corrects them after migration.
ALTER TABLE public.founding_member_spots DROP CONSTRAINT IF EXISTS founding_spot_number_range;
ALTER TABLE public.founding_member_spots ADD CONSTRAINT founding_spot_number_range CHECK (
  (is_test AND founding_member_number > 25) OR
  (NOT is_test AND founding_member_number BETWEEN 1 AND 25)
);
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS founding_subscription_number_range;
ALTER TABLE public.subscriptions ADD CONSTRAINT founding_subscription_number_range CHECK (
  (founding_member_number IS NULL AND NOT founding_member_is_test) OR
  (founding_member_number IS NOT NULL AND (
    (founding_member_is_test AND founding_member_number > 25) OR
    (NOT founding_member_is_test AND founding_member_number BETWEEN 1 AND 25)
  ))
);
ALTER TABLE public.founding_member_spots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founding_member_spots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.founding_member_spots TO service_role;

INSERT INTO public.founding_member_spots (founding_member_number, user_id, is_test)
SELECT founding_member_number, user_id, founding_member_is_test FROM public.subscriptions
WHERE founding_member_number IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
    LEFT JOIN public.founding_member_spots f ON f.user_id = s.user_id
    WHERE s.founding_member_number IS NOT NULL AND
      (s.founding_member_number IS DISTINCT FROM f.founding_member_number OR
       s.founding_member_is_test IS DISTINCT FROM f.is_test)
  ) THEN
    RAISE EXCEPTION 'Resolve inconsistent issued Founding Member identities before migrating';
  END IF;
END;
$$;

-- No browser/API role can invoke corrections or forge the trigger bypass.
-- The custom setting alone is insufficient: the effective SQL role must also
-- be postgres. SECURITY DEFINER triggers use the effective role setting rather
-- than current_user (which would incorrectly identify service-role calls).
CREATE OR REPLACE FUNCTION public.is_founding_admin_correction()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.current_setting('elidan.founding_admin_correction', true) = 'on'
    AND (pg_catalog.current_setting('role', true) = 'postgres' OR
      (pg_catalog.current_setting('role', true) = 'none' AND session_user = 'postgres'));
$$;
REVOKE ALL ON FUNCTION public.is_founding_admin_correction() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_issued_founding_spot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF public.is_founding_admin_correction() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Issued Founding Member spots cannot be changed or deleted';
END;
$$;
CREATE OR REPLACE TRIGGER protect_issued_founding_spots
  BEFORE UPDATE OR DELETE ON public.founding_member_spots
  FOR EACH ROW EXECUTE FUNCTION public.protect_issued_founding_spot();

CREATE OR REPLACE FUNCTION public.preserve_founding_member_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  issued_number integer;
  issued_owner uuid;
  issued_test boolean;
BEGIN
  IF public.is_founding_admin_correction() THEN RETURN NEW; END IF;
  IF pg_catalog.current_setting('role', true) IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.founding_member_number IS NOT NULL OR NEW.founding_member_cancelled_at IS NOT NULL OR
         NEW.founding_member_grace_ends_at IS NOT NULL OR NEW.founding_member_is_test THEN
        RAISE insufficient_privilege USING MESSAGE = 'Founding membership is server-managed';
      END IF;
    ELSIF NEW.founding_member_number IS DISTINCT FROM OLD.founding_member_number OR
          NEW.founding_member_cancelled_at IS DISTINCT FROM OLD.founding_member_cancelled_at OR
          NEW.founding_member_grace_ends_at IS DISTINCT FROM OLD.founding_member_grace_ends_at OR
          NEW.founding_member_is_test IS DISTINCT FROM OLD.founding_member_is_test THEN
      RAISE insufficient_privilege USING MESSAGE = 'Founding membership is server-managed';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.founding_member_number IS NOT NULL AND
       (NEW.founding_member_number IS DISTINCT FROM OLD.founding_member_number OR
        NEW.user_id IS DISTINCT FROM OLD.user_id OR
        NEW.founding_member_is_test IS DISTINCT FROM OLD.founding_member_is_test) THEN
      RAISE EXCEPTION 'A Founding Member number cannot be cleared, changed or reassigned';
    END IF;
  END IF;

  -- Customer range + unique keys enforce the cap under concurrent claims.
  -- Do not take the admin lock here: row updates already hold subscription
  -- locks, which would invert the admin operation's lock order.
  SELECT founding_member_number, is_test INTO issued_number, issued_test
    FROM public.founding_member_spots WHERE user_id = NEW.user_id;
  IF issued_number IS NOT NULL THEN
    IF NEW.founding_member_number IS NULL THEN
      NEW.founding_member_number := issued_number;
    ELSIF NEW.founding_member_number <> issued_number THEN
      RAISE EXCEPTION 'This account already owns another Founding Member number';
    END IF;
    NEW.founding_member_is_test := issued_test;
  ELSIF NEW.founding_member_number IS NOT NULL THEN
    IF NEW.founding_member_is_test THEN
      RAISE insufficient_privilege USING MESSAGE = 'Only an administrator can assign test memberships';
    END IF;
    SELECT user_id INTO issued_owner FROM public.founding_member_spots
      WHERE founding_member_number = NEW.founding_member_number;
    IF issued_owner IS NOT NULL THEN
      RAISE unique_violation USING MESSAGE = 'Founding Member number already issued';
    END IF;
    IF (SELECT count(*) FROM public.founding_member_spots WHERE NOT is_test) >= 25 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'founding_spots_exhausted';
    END IF;
    INSERT INTO public.founding_member_spots (founding_member_number, user_id)
      VALUES (NEW.founding_member_number, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER preserve_founding_member_identity
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.preserve_founding_member_identity();

REVOKE ALL ON FUNCTION public.protect_issued_founding_spot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preserve_founding_member_identity() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.founding_member_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  database_actor text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  before_identity jsonb,
  after_identity jsonb
);
ALTER TABLE public.founding_member_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founding_member_corrections FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_founding_correction_audit()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Founding correction audit entries cannot be changed or deleted';
END;
$$;
CREATE OR REPLACE TRIGGER protect_founding_correction_audit
  BEFORE UPDATE OR DELETE ON public.founding_member_corrections
  FOR EACH ROW EXECUTE FUNCTION public.protect_founding_correction_audit();
REVOKE ALL ON FUNCTION public.protect_founding_correction_audit() FROM PUBLIC;

-- Run manually in the SQL editor as postgres. Intentionally NOT SECURITY DEFINER
-- and NOT callable by service_role. Changes identity only, never billing/access.
CREATE OR REPLACE FUNCTION public.admin_correct_founding_membership(
  p_user_id uuid, p_member_number integer, p_is_test boolean,
  p_reason text, p_actor text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  before_identity jsonb;
  after_identity jsonb;
  subscription_number integer;
  subscription_test boolean;
  subscription_exists boolean;
  previous_bypass text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE insufficient_privilege USING MESSAGE = 'Database-owner access required';
  END IF;
  IF p_user_id IS NULL OR p_is_test IS NULL OR
     p_reason IS NULL OR length(btrim(p_reason)) = 0 OR
     p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'Account, test designation, reason and administrator name are required';
  END IF;
  IF (p_member_number IS NULL AND p_is_test) OR
     (p_member_number IS NOT NULL AND
       ((p_is_test AND p_member_number <= 25) OR
        (NOT p_is_test AND p_member_number NOT BETWEEN 1 AND 25))) THEN
    RAISE EXCEPTION 'Customer numbers must be 1-25; test numbers must exceed 25; clearing requires is_test=false';
  END IF;

  -- Serialize administrative corrections. Unique keys arbitrate collisions
  -- with normal issuance without locking all ordinary subscription updates.
  PERFORM pg_catalog.pg_advisory_xact_lock(749302251);
  SELECT founding_member_number, founding_member_is_test
    INTO subscription_number, subscription_test FROM public.subscriptions
    WHERE user_id = p_user_id FOR UPDATE;
  subscription_exists := FOUND;
  IF NOT subscription_exists AND p_member_number IS NOT NULL THEN
    RAISE EXCEPTION 'Create the account subscription row before assigning a membership';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
      'member_number', founding_member_number, 'is_test', is_test,
      'issued_at', issued_at, 'subscription_number', subscription_number,
      'subscription_is_test', subscription_test
    ) INTO before_identity FROM public.founding_member_spots
    WHERE user_id = p_user_id FOR UPDATE;
  IF before_identity IS NULL AND subscription_number IS NOT NULL THEN
    RAISE EXCEPTION 'Subscription identity is missing from the registry; resolve before correcting';
  END IF;

  previous_bypass := pg_catalog.current_setting('elidan.founding_admin_correction', true);
  PERFORM pg_catalog.set_config('elidan.founding_admin_correction', 'on', true);
  DELETE FROM public.founding_member_spots WHERE user_id = p_user_id;
  IF p_member_number IS NOT NULL THEN
    -- Primary/unique keys reject numbers owned by another account; failure rolls
    -- back the entire correction, including deletion of the original identity.
    INSERT INTO public.founding_member_spots (founding_member_number, user_id, is_test)
      VALUES (p_member_number, p_user_id, p_is_test);
    after_identity := pg_catalog.jsonb_build_object('member_number', p_member_number, 'is_test', p_is_test);
  END IF;
  UPDATE public.subscriptions SET
    founding_member_number = p_member_number, founding_member_is_test = p_is_test
    WHERE user_id = p_user_id;
  INSERT INTO public.founding_member_corrections
    (user_id, actor, database_actor, reason, before_identity, after_identity)
    VALUES (p_user_id, btrim(p_actor), session_user, btrim(p_reason), before_identity, after_identity);
  PERFORM pg_catalog.set_config('elidan.founding_admin_correction', coalesce(previous_bypass, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_correct_founding_membership(uuid, integer, boolean, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_correct_founding_membership(uuid, integer, boolean, text, text)
  TO postgres;
NOTIFY pgrst, 'reload schema';
COMMIT;
