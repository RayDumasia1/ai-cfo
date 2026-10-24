-- PREVIEW ONLY: never run in production, including on production test accounts.
-- Run after financial revision history AND 2026-10-24-preserve-settings-on-financial-clear.sql.
-- Uses two dedicated preview accounts and rolls ALL test changes back.
-- Replace the two NULLs below. Run the COMPLETE script, including ROLLBACK.
-- If it fails, run ROLLBACK in the same session before retrying.
BEGIN;
DO $$
DECLARE
  account_a uuid := NULL; -- 'first-preview-test-user-uuid'
  account_b uuid := NULL; -- 'second-preview-test-user-uuid'
BEGIN
  IF current_user <> 'postgres' OR account_a IS NULL OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Run as postgres with two distinct dedicated PREVIEW test-account UUIDs';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  PERFORM set_config('elidan.clear_verify_account_a', account_a::text, true);
  PERFORM set_config('elidan.clear_verify_account_b', account_b::text, true);
  ASSERT NOT has_function_privilege('anon', 'public.clear_financial_data(uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.clear_financial_data(uuid)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.clear_financial_data(uuid)', 'EXECUTE');
END;
$$;

CREATE FUNCTION pg_temp.clear_verification_snapshot(account_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'revisions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'subscription', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;
CREATE FUNCTION pg_temp.fail_clear_verification_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('elidan.clear_verify_fail', true) = 'on'
     AND NEW.user_id = current_setting('elidan.clear_verify_account_a')::uuid
     AND NEW.import_type = 'manual' AND NEW.error_message = 'User cleared data' THEN
    RAISE EXCEPTION 'Forced clear audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_atomic_clear_rollback BEFORE INSERT ON public.data_imports
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_clear_verification_audit();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.clear_verify_account_a')::uuid;
  account_b uuid := current_setting('elidan.clear_verify_account_b')::uuid;
  before_b jsonb := pg_temp.clear_verification_snapshot(account_b);
  baseline jsonb;
  result jsonb;
  denied boolean;
  audits_before integer;
  old_version text;
BEGIN
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-09-01","closing_cash":90}]',
    '{"min_cash_reserve":123,"runway_warning_threshold":9,"runway_danger_threshold":4,"burn_rate_warning_pct":0.2,"invoice_overdue_days":45}',
    'atomic-clear-verification-seed.xlsx');
  -- Uploads no longer apply workbook thresholds. Seed settings directly so
  -- this verifier can assert exact preservation of customized settings.
  UPDATE public.business_profiles SET min_cash_reserve = 123,
    runway_warning_threshold = 9, runway_danger_threshold = 4,
    burn_rate_warning_pct = 0.2, invoice_overdue_days = 45
  WHERE user_id = account_a;
  INSERT INTO public.expense_categories (user_id, business_id, month_date, category, amount)
    SELECT account_a, id, '2026-09-01', 'Clear rollback fixture', 2
    FROM public.business_profiles WHERE user_id = account_a;
  -- Avoid depending on the timestamp precision or execution speed of this test.
  UPDATE public.business_profiles SET data_version = '2000-01-01T00:00:00Z' WHERE user_id = account_a;
  baseline := pg_temp.clear_verification_snapshot(account_a);

  -- Fail at the last write after deletes/profile/version have all changed.
  PERFORM set_config('elidan.clear_verify_fail', 'on', true);
  denied := false;
  BEGIN
    PERFORM public.clear_financial_data(account_a);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Forced clear audit failure' THEN RAISE; END IF;
    denied := true;
  END;
  ASSERT denied, 'Late clear failure was not triggered';
  ASSERT pg_temp.clear_verification_snapshot(account_a) = baseline, 'Failed clear left partial changes';
  PERFORM set_config('elidan.clear_verify_fail', 'off', true);

  SELECT count(*) INTO audits_before FROM public.data_imports WHERE user_id = account_a;
  SELECT data_version::text INTO old_version FROM public.business_profiles WHERE user_id = account_a;
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.clear_financial_data(account_a);
  EXECUTE 'RESET ROLE';
  ASSERT result = '{"cleared":true}'::jsonb;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a);
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a);
  ASSERT (SELECT data_version::text FROM public.business_profiles WHERE user_id = account_a) IS DISTINCT FROM old_version;
  ASSERT (SELECT count(*) FROM public.data_imports WHERE user_id = account_a) = audits_before + 1;
  ASSERT (pg_temp.clear_verification_snapshot(account_a)->'profile'->0)
    - ARRAY['data_version','updated_at']
    = (baseline->'profile'->0)
    - ARRAY['data_version','updated_at'],
    'Clear changed account details or settings';
  ASSERT pg_temp.clear_verification_snapshot(account_a)->'subscription' = baseline->'subscription', 'Clear changed billing';
  ASSERT pg_temp.clear_verification_snapshot(account_b) = before_b, 'Clear changed another account';

  -- Clear/clear and clear/import sequences leave complete, predictable data.
  PERFORM public.clear_financial_data(account_a);
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a);
  PERFORM public.replace_financial_import(account_a,
    '[{"month_date":"2026-10-01","closing_cash":80}]', '{}', 'atomic-clear-verification-reimport.xlsx');
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 1;
  ASSERT (SELECT closing_cash FROM public.financial_months WHERE user_id = account_a) = 80;
  ASSERT pg_temp.clear_verification_snapshot(account_b) = before_b;
  ASSERT pg_temp.clear_verification_snapshot(account_a)->'subscription' = baseline->'subscription';

  denied := false;
  BEGIN
    PERFORM public.clear_financial_data(NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  ASSERT denied, 'Null account accepted';
END;
$$;
ROLLBACK;
