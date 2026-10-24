-- PREVIEW ONLY. Run after 2026-10-23-atomic-financial-import.sql.
-- Set two distinct dedicated preview test-account UUIDs below.
-- This script temporarily replaces their data, tests a forced late failure,
-- and ROLLS EVERYTHING BACK. Never use real customer accounts.
-- If an assertion fails, run ROLLBACK before retrying.
BEGIN;

DO $$
DECLARE
  account_a uuid := NULL; -- Replace NULL with 'first-preview-test-user-uuid'
  account_b uuid := NULL; -- Replace NULL with 'second-preview-test-user-uuid'
BEGIN
  IF current_user <> 'postgres' OR account_a IS NULL OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Run as postgres with two distinct dedicated PREVIEW test-account UUIDs';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  PERFORM set_config('elidan.import_verify_account_a', account_a::text, true);
  PERFORM set_config('elidan.import_verify_account_b', account_b::text, true);
  ASSERT NOT has_function_privilege('anon', 'public.replace_financial_import(uuid,jsonb,jsonb,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.replace_financial_import(uuid,jsonb,jsonb,text)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.replace_financial_import(uuid,jsonb,jsonb,text)', 'EXECUTE');
END;
$$;

CREATE FUNCTION pg_temp.import_verification_snapshot(account_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'subscription', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

-- Force failure at the LAST write, after rows, profile, and version changed.
CREATE FUNCTION pg_temp.fail_import_verification_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('elidan.import_verify_fail', true) = 'on'
     AND NEW.user_id = current_setting('elidan.import_verify_account_a')::uuid
     AND NEW.filename = 'atomic-verification-forced-failure.xlsx' THEN
    RAISE EXCEPTION 'Forced import audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_atomic_import_rollback BEFORE INSERT ON public.data_imports
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_import_verification_audit();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.import_verify_account_a')::uuid;
  account_b uuid := current_setting('elidan.import_verify_account_b')::uuid;
  before_b jsonb := pg_temp.import_verification_snapshot(account_b);
  before_subscription jsonb;
  baseline jsonb;
  result jsonb;
  invalid_months jsonb;
  denied boolean;
  success_count integer;
BEGIN
  before_subscription := pg_temp.import_verification_snapshot(account_a)->'subscription';

  -- Seed a replaceable dataset inside this rollback-only transaction.
  -- Exercise the same role used by the API, not only the database owner.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-08-01","closing_cash":100}]', '{}', 'atomic-verification-seed.xlsx');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO success_count FROM public.data_imports WHERE user_id = account_a AND status = 'success';
  INSERT INTO public.expense_categories (user_id, business_id, month_date, category, amount)
    SELECT account_a, id, '2026-08-01', 'Verification fixture', 1
    FROM public.business_profiles WHERE user_id = account_a;

  -- Initialize a genuinely empty onboarding field, rather than relying on
  -- workbook replacement of a name already saved in account settings.
  UPDATE public.business_profiles SET business_name = NULL, onboarding_completed_at = NULL
    WHERE user_id = account_a;
  result := public.replace_financial_import(account_a,
    '[{"month_date":"2026-09-01","closing_cash":90},{"month_date":"2026-10-01","closing_cash":80}]',
    '{"business_name":"Atomic import verification"}', 'atomic-verification-success.xlsx');
  ASSERT result = '{"replaced":true,"months_imported":2}'::jsonb;
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 2;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a AND month_date = '2026-08-01');
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
  ASSERT (SELECT count(*) FROM public.data_imports WHERE user_id = account_a AND status = 'success') = success_count + 1;
  ASSERT (SELECT business_name FROM public.business_profiles WHERE user_id = account_a) = 'Atomic import verification';
  ASSERT (SELECT data_version FROM public.business_profiles WHERE user_id = account_a) IS NOT NULL;
  ASSERT pg_temp.import_verification_snapshot(account_b) = before_b, 'Another account changed';
  ASSERT pg_temp.import_verification_snapshot(account_a)->'subscription' = before_subscription, 'Billing state changed';

  -- Also prove category deletions roll back on a failed replacement.
  INSERT INTO public.expense_categories (user_id, business_id, month_date, category, amount)
    SELECT account_a, id, '2026-09-01', 'Rollback fixture', 2
    FROM public.business_profiles WHERE user_id = account_a;
  baseline := pg_temp.import_verification_snapshot(account_a);
  PERFORM set_config('elidan.import_verify_fail', 'on', true);
  denied := false;
  BEGIN
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-11-01","closing_cash":70}]',
      '{"business_name":"Must roll back"}', 'atomic-verification-forced-failure.xlsx');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Forced import audit failure' THEN RAISE; END IF;
    denied := true;
  END;
  ASSERT denied, 'Late failure was not triggered';
  ASSERT pg_temp.import_verification_snapshot(account_a) = baseline,
    'Failure must restore old months, profile, version, categories, and audit records';
  PERFORM set_config('elidan.import_verify_fail', 'off', true);

  FOR invalid_months IN SELECT value FROM jsonb_array_elements(
    '[[],{},[{"month_date":"2026-09-01"},{"month_date":"2026-09-01"}],[{"month_date":"2026-09-15"}]]'::jsonb
  ) LOOP
    denied := false;
    BEGIN
      PERFORM public.replace_financial_import(account_a, invalid_months, '{}', 'invalid.xlsx');
    EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
    END;
    ASSERT denied, 'Invalid payload was accepted';
    ASSERT pg_temp.import_verification_snapshot(account_a) = baseline;
  END LOOP;

  denied := false;
  BEGIN
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-11-01"}]', jsonb_build_object('user_id', account_b), 'spoofed.xlsx');
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  ASSERT denied, 'Ownership injection was accepted';
  ASSERT pg_temp.import_verification_snapshot(account_a) = baseline;
  ASSERT pg_temp.import_verification_snapshot(account_b) = before_b;
END;
$$;

ROLLBACK;
