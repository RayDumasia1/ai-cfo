-- PREVIEW ONLY. Run after 2026-10-23-preserve-import-settings.sql. Never run in production.
-- Set two distinct dedicated preview test-account UUIDs below.
-- This script temporarily replaces their data, tests a forced late failure,
-- and ROLLS EVERYTHING BACK. Never use real customer accounts.
-- If an assertion fails, run ROLLBACK before retrying.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false; -- Set true ONLY in the dedicated preview project.
  account_a uuid := NULL; -- Replace NULL with 'first-preview-test-user-uuid'
  account_b uuid := NULL; -- Replace NULL with 'second-preview-test-user-uuid'
BEGIN
  IF NOT preview_confirmed OR current_user <> 'postgres' OR account_a IS NULL OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and run as postgres with two distinct dedicated preview test-account UUIDs';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  IF current_setting('plpgsql.check_asserts') <> 'on' THEN
    RAISE EXCEPTION 'Verification requires plpgsql.check_asserts enabled';
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
  settings_before jsonb;
  reserve_value jsonb;
BEGIN
  before_subscription := pg_temp.import_verification_snapshot(account_a)->'subscription';

  -- Seed a replaceable dataset inside this rollback-only transaction.
  -- Exercise the same role used by the API, not only the database owner.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-08-01","closing_cash":100}]', '{}', 'atomic-verification-seed.xlsx');
  EXECUTE 'RESET ROLE';
  -- Account settings are authoritative even for calls from old app versions.
  FOR reserve_value IN SELECT value FROM jsonb_array_elements('[null,0,4321.75]'::jsonb) LOOP
    UPDATE public.business_profiles SET min_cash_reserve = (reserve_value #>> '{}')::numeric,
      runway_warning_threshold = 8.5, runway_danger_threshold = 2.5,
      burn_rate_warning_pct = 0.105, invoice_overdue_days = 47
    WHERE user_id = account_a;
    ASSERT (SELECT runway_warning_threshold = 8.5 AND runway_danger_threshold = 2.5
      AND burn_rate_warning_pct = 0.105 AND invoice_overdue_days = 47
      AND min_cash_reserve IS NOT DISTINCT FROM (reserve_value #>> '{}')::numeric
      FROM public.business_profiles WHERE user_id = account_a),
      'Schema did not preserve fixture precision before import';
    SELECT to_jsonb(bp) - ARRAY['business_name','industry','accounting_system','employee_count','data_version','updated_at']
      INTO settings_before FROM public.business_profiles bp WHERE user_id = account_a;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-08-01","closing_cash":100}]',
      '{"business_name":"Settings preservation fixture","min_cash_reserve":25000,"runway_warning_threshold":6,"runway_danger_threshold":3,"burn_rate_warning_pct":0.1,"invoice_overdue_days":30}',
      'settings-preservation-legacy.xlsx');
    -- Ignored settings must not even be coerced into typed record fields.
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-08-01","closing_cash":100}]',
      '{"runway_warning_threshold":"ignored legacy value","min_cash_reserve":null}',
      'settings-preservation-ignored-values.xlsx');
    -- The new adapter omits settings entirely; that must preserve them too.
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-08-01","closing_cash":100}]', '{}',
      'settings-preservation-new-client.xlsx');
    EXECUTE 'RESET ROLE';
    ASSERT (SELECT to_jsonb(bp) - ARRAY['business_name','industry','accounting_system','employee_count','data_version','updated_at']
      FROM public.business_profiles bp WHERE user_id = account_a) = settings_before,
      'Import changed account settings, identity, or unrelated profile state';
    ASSERT pg_temp.import_verification_snapshot(account_b) = before_b, 'Another account changed';
    ASSERT pg_temp.import_verification_snapshot(account_a)->'subscription' = before_subscription, 'Billing state changed';
  END LOOP;
  SELECT count(*) INTO success_count FROM public.data_imports WHERE user_id = account_a AND status = 'success';
  INSERT INTO public.expense_categories (user_id, business_id, month_date, category, amount)
    SELECT account_a, id, '2026-08-01', 'Verification fixture', 1
    FROM public.business_profiles WHERE user_id = account_a;

  UPDATE public.business_profiles SET business_name = NULL, industry = NULL,
    accounting_system = NULL, employee_count = NULL, onboarding_completed_at = NULL
  WHERE user_id = account_a;
  result := public.replace_financial_import(account_a,
    '[{"month_date":"2026-09-01","closing_cash":90},{"month_date":"2026-10-01","closing_cash":80}]',
    '{"business_name":"Atomic import verification","industry":"Fixture industry","accounting_system":"Fixture accounting","employee_count":7}',
    'atomic-verification-success.xlsx');
  ASSERT result = '{"replaced":true,"months_imported":2}'::jsonb;
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 2;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a AND month_date = '2026-08-01');
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
  ASSERT (SELECT count(*) FROM public.data_imports WHERE user_id = account_a AND status = 'success') = success_count + 1;
  ASSERT (SELECT business_name FROM public.business_profiles WHERE user_id = account_a) = 'Atomic import verification';
  ASSERT (SELECT industry = 'Fixture industry' AND accounting_system = 'Fixture accounting'
    AND employee_count = 7 AND onboarding_completed_at IS NULL
    FROM public.business_profiles WHERE user_id = account_a), 'Missing onboarding details were not initialized';
  ASSERT (SELECT data_version FROM public.business_profiles WHERE user_id = account_a) IS NOT NULL;
  ASSERT pg_temp.import_verification_snapshot(account_b) = before_b, 'Another account changed';
  ASSERT pg_temp.import_verification_snapshot(account_a)->'subscription' = before_subscription, 'Billing state changed';

  -- Even BEFORE completion, a name already saved by onboarding must win.
  SELECT to_jsonb(bp) - ARRAY['data_version','updated_at'] INTO settings_before
    FROM public.business_profiles bp WHERE user_id = account_a;
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-09-01","closing_cash":90}]',
    '{"business_name":"Do not overwrite","industry":"Other","accounting_system":"Other","employee_count":99}',
    'onboarding-existing-details.xlsx');
  ASSERT (SELECT to_jsonb(bp) - ARRAY['data_version','updated_at']
    FROM public.business_profiles bp WHERE user_id = account_a) = settings_before,
    'Workbook overwrote details saved during onboarding';

  -- After completion, preserve both existing values and intentionally empty fields.
  UPDATE public.business_profiles SET onboarding_completed_at = '2026-10-01T00:00:00Z'
    WHERE user_id = account_a;
  FOR reserve_value IN SELECT value FROM jsonb_array_elements('[false,true]'::jsonb) LOOP
    IF reserve_value = 'true'::jsonb THEN
      UPDATE public.business_profiles SET business_name = NULL, industry = NULL,
        accounting_system = NULL, employee_count = NULL WHERE user_id = account_a;
    END IF;
    SELECT to_jsonb(bp) - ARRAY['data_version','updated_at'] INTO settings_before
      FROM public.business_profiles bp WHERE user_id = account_a;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.replace_financial_import(account_a,
      '[{"month_date":"2026-09-01","closing_cash":90}]',
      '{"business_name":"Do not refill","industry":"Other","accounting_system":"Other","employee_count":99}',
      'completed-onboarding-details.xlsx');
    EXECUTE 'RESET ROLE';
    ASSERT (SELECT to_jsonb(bp) - ARRAY['data_version','updated_at']
      FROM public.business_profiles bp WHERE user_id = account_a) = settings_before,
      'Completed account details were changed or refilled';
  END LOOP;
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
