-- PREVIEW ONLY, after 2026-10-22-founding-billing-cycle-reinstatement.sql.
-- Fill in two dedicated preview test-account UUIDs below. They must have
-- subscription rows. Run the WHOLE file as postgres. All changes roll back.
-- Requires at least one available customer spot after removing these fixtures.
BEGIN;
DO $$
DECLARE
  account_a uuid := NULL; -- Replace with dedicated preview test account UUID.
  account_b uuid := NULL; -- Replace with a different preview test account UUID.
  customer_number integer;
  test_number integer;
  before_count integer;
  before_audit bigint;
  denied boolean;
BEGIN
  IF current_user <> 'postgres' OR account_a IS NULL OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Run as postgres with two distinct dedicated PREVIEW test-account UUIDs';
  END IF;
  IF (SELECT count(*) FROM public.subscriptions WHERE user_id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview fixtures require subscription rows';
  END IF;
  ASSERT NOT has_function_privilege('anon', 'public.admin_correct_founding_membership(uuid,integer,boolean,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.admin_correct_founding_membership(uuid,integer,boolean,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.admin_correct_founding_membership(uuid,integer,boolean,text,text)', 'EXECUTE');
  ASSERT NOT has_table_privilege('authenticated', 'public.founding_member_corrections', 'SELECT');
  ASSERT NOT has_table_privilege('service_role', 'public.founding_member_spots', 'DELETE');

  SELECT count(*) INTO before_audit FROM public.founding_member_corrections;
  PERFORM public.admin_correct_founding_membership(account_b, NULL, false, 'Preview verification fixture reset', 'Preview verifier');
  SELECT n INTO test_number FROM generate_series(26, 10000) n
    WHERE NOT EXISTS (SELECT 1 FROM public.founding_member_spots f WHERE f.founding_member_number = n)
    ORDER BY n LIMIT 1;
  PERFORM public.admin_correct_founding_membership(account_a, test_number, true, 'Preview verification test designation', 'Preview verifier');
  ASSERT (SELECT founding_member_is_test AND founding_member_number = test_number FROM public.subscriptions WHERE user_id = account_a);
  SELECT count(*) INTO before_count FROM public.founding_member_spots WHERE NOT is_test;
  ASSERT (SELECT count(*) FROM public.founding_member_spots WHERE is_test AND user_id = account_a) = 1;

  SELECT n INTO customer_number FROM generate_series(1, 25) n
    WHERE NOT EXISTS (SELECT 1 FROM public.founding_member_spots f WHERE f.founding_member_number = n)
    ORDER BY n LIMIT 1;
  IF customer_number IS NULL THEN RAISE EXCEPTION 'Preview fixture requires an available customer spot'; END IF;
  PERFORM public.admin_correct_founding_membership(account_b, customer_number, false, 'Preview verification customer assignment', 'Preview verifier');
  ASSERT (SELECT count(*) FROM public.founding_member_spots WHERE NOT is_test) = before_count + 1;

  -- Ordinary service-role cancellation must retain the issued customer spot.
  EXECUTE 'SET LOCAL ROLE service_role';
  UPDATE public.subscriptions SET status = 'cancelled', feature_tier = 'suspended' WHERE user_id = account_b;
  UPDATE public.subscriptions SET status = 'cancelled', feature_tier = 'suspended' WHERE user_id = account_a;
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT founding_member_number FROM public.subscriptions WHERE user_id = account_b) = customer_number;
  ASSERT (SELECT count(*) FROM public.founding_member_spots WHERE NOT is_test) = before_count + 1;
  ASSERT (SELECT is_test FROM public.founding_member_spots WHERE user_id = account_a);

  -- A caller cannot spoof the bypass by setting the custom transaction flag.
  PERFORM set_config('elidan.founding_admin_correction', 'on', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  denied := false;
  BEGIN
    UPDATE public.subscriptions SET founding_member_number = NULL WHERE user_id = account_b;
  EXCEPTION WHEN OTHERS THEN denied := true;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('elidan.founding_admin_correction', '', true);
  ASSERT denied, 'Service role must not clear a customer identity, even with a forged flag';

  -- A collision rolls back the original identity and produces no audit entry.
  denied := false;
  BEGIN
    PERFORM public.admin_correct_founding_membership(account_a, customer_number, false, 'Preview collision check', 'Preview verifier');
  EXCEPTION WHEN unique_violation THEN denied := true;
  END;
  ASSERT denied;
  ASSERT (SELECT founding_member_number FROM public.subscriptions WHERE user_id = account_a) = test_number;
  ASSERT (SELECT founding_member_number FROM public.founding_member_spots WHERE user_id = account_a) = test_number;

  denied := false;
  BEGIN
    PERFORM public.admin_correct_founding_membership(account_a, 25, true, 'Preview invalid test range', 'Preview verifier');
  EXCEPTION WHEN raise_exception THEN denied := true;
  END;
  ASSERT denied;
  denied := false;
  BEGIN
    PERFORM public.admin_correct_founding_membership(account_a, 26, false, 'Preview invalid customer range', 'Preview verifier');
  EXCEPTION WHEN raise_exception THEN denied := true;
  END;
  ASSERT denied;
  denied := false;
  BEGIN
    PERFORM public.admin_correct_founding_membership(account_a, NULL, false, ' ', 'Preview verifier');
  EXCEPTION WHEN raise_exception THEN denied := true;
  END;
  ASSERT denied, 'Corrections require a nonempty reason';

  PERFORM public.admin_correct_founding_membership(account_b, NULL, false, 'Preview verification release', 'Preview verifier');
  ASSERT (SELECT founding_member_number IS NULL AND NOT founding_member_is_test FROM public.subscriptions WHERE user_id = account_b);
  ASSERT NOT EXISTS (SELECT 1 FROM public.founding_member_spots WHERE founding_member_number = customer_number);
  ASSERT (SELECT count(*) FROM public.founding_member_spots WHERE NOT is_test) = before_count;
  ASSERT (SELECT count(*) FROM public.founding_member_corrections) = before_audit + 4;
  ASSERT EXISTS (SELECT 1 FROM public.founding_member_corrections WHERE user_id = account_b
    AND reason = 'Preview verification release' AND before_identity->>'member_number' = customer_number::text
    AND after_identity IS NULL AND actor = 'Preview verifier');
  denied := false;
  BEGIN
    DELETE FROM public.founding_member_corrections WHERE user_id = account_b;
  EXCEPTION WHEN raise_exception THEN denied := true;
  END;
  ASSERT denied, 'Audit entries must be append-only';
  RAISE NOTICE 'Founding membership checks passed. All fixture changes will roll back.';
END;
$$;
ROLLBACK;
