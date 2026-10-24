-- PREVIEW ONLY. Never run in production, including on production test accounts.
-- Run AFTER 2026-10-23-financial-import-modes.sql. Use two dedicated preview accounts.
-- Run the COMPLETE script through ROLLBACK. On failure, run ROLLBACK before retrying.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL; -- 'first-dedicated-preview-account-uuid'
  account_b uuid := NULL; -- 'second-dedicated-preview-account-uuid'
BEGIN
  IF NOT preview_confirmed OR current_user <> 'postgres' OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a, account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  IF current_setting('plpgsql.check_asserts') <> 'on' THEN
    RAISE EXCEPTION 'Verification requires plpgsql.check_asserts enabled';
  END IF;
  PERFORM set_config('elidan.mode_verify_a', account_a::text, true);
  PERFORM set_config('elidan.mode_verify_b', account_b::text, true);
  ASSERT NOT has_function_privilege('anon','public.import_financial_data(uuid,jsonb,jsonb,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.import_financial_data(uuid,jsonb,jsonb,text,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.import_financial_data(uuid,jsonb,jsonb,text,text)','EXECUTE');
END;
$$;

CREATE FUNCTION pg_temp.mode_snapshot(account_id uuid) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.month_date, t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.month_date, t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'revisions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'subscription', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

CREATE FUNCTION pg_temp.mode_fail_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('elidan.mode_verify_fail',true) = 'on'
     AND NEW.user_id = current_setting('elidan.mode_verify_a')::uuid THEN
    RAISE EXCEPTION 'Forced mode verification audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_import_mode_audit BEFORE INSERT ON public.data_imports
  FOR EACH ROW EXECUTE FUNCTION pg_temp.mode_fail_audit();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.mode_verify_a')::uuid;
  account_b uuid := current_setting('elidan.mode_verify_b')::uuid;
  other_before jsonb;
  subscription_before jsonb := pg_temp.mode_snapshot(account_a)->'subscription';
  baseline jsonb;
  untouched_month jsonb;
  untouched_category jsonb;
  result jsonb;
  revision public.financial_data_revisions%ROWTYPE;
  requested_mode text;
  denied boolean;
BEGIN
  -- Populate the other account's history as well as current data for isolation checks.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_b,
    '[{"month_date":"2026-08-01","closing_cash":10}]','{}','mode-other-seed.xlsx');
  PERFORM public.replace_financial_import(account_b,
    '[{"month_date":"2026-09-01","closing_cash":20}]','{}','mode-other-replace.xlsx');
  PERFORM public.clear_financial_data(account_a);
  result := public.import_financial_data(account_a,
    '[{"month_date":"2026-08-01","closing_cash":90,"payroll":9},{"month_date":"2026-09-01","closing_cash":80}]',
    '{}','mode-seed.xlsx','update_months');
  EXECUTE 'RESET ROLE';
  other_before := pg_temp.mode_snapshot(account_b);
  ASSERT result->'replaced' = 'false'::jsonb AND result->'months_total' = '2'::jsonb;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a);
  UPDATE public.business_profiles SET business_name = 'Mode fixture', min_cash_reserve = 77,
    runway_warning_threshold = 8, runway_danger_threshold = 2, burn_rate_warning_pct = 0.105,
    invoice_overdue_days = 47, onboarding_completed_at = '2026-10-01T00:00:00Z', data_version = 'mode-source/opaque'
    WHERE user_id = account_a;
  INSERT INTO public.expense_categories (user_id,business_id,month_date,category,amount)
    SELECT account_a,id,'2026-08-01','Changed month fixture',1 FROM public.business_profiles WHERE user_id = account_a;
  INSERT INTO public.expense_categories (user_id,business_id,month_date,category,amount)
    SELECT account_a,id,'2026-09-01','Untouched month fixture',2 FROM public.business_profiles WHERE user_id = account_a;
  SELECT to_jsonb(t) INTO untouched_month FROM public.financial_months t
    WHERE user_id = account_a AND month_date = '2026-09-01';
  SELECT to_jsonb(t) INTO untouched_category FROM public.expense_categories t
    WHERE user_id = account_a AND month_date = '2026-09-01';
  baseline := pg_temp.mode_snapshot(account_a);

  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.import_financial_data(account_a,
    '[{"month_date":"2026-08-01","closing_cash":42},{"month_date":"2026-10-01","closing_cash":70}]',
    '{"business_name":"Do not overwrite","min_cash_reserve":25000}', 'mode-update.xlsx','update_months');
  EXECUTE 'RESET ROLE';
  ASSERT result = '{"mode":"update_months","replaced":true,"months_imported":2,"months_total":3,"date_from":"2026-08-01","date_to":"2026-10-01","current_cash":70}'::jsonb;
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 3;
  ASSERT (SELECT closing_cash = 42 AND payroll IS NULL FROM public.financial_months
    WHERE user_id = account_a AND month_date = '2026-08-01'), 'Month was added to or partially merged instead of replaced';
  ASSERT (SELECT to_jsonb(t) FROM public.financial_months t WHERE user_id = account_a
    AND month_date = '2026-09-01') = untouched_month, 'Untouched month changed';
  ASSERT (SELECT to_jsonb(t) FROM public.expense_categories t WHERE user_id = account_a
    AND month_date = '2026-09-01') = untouched_category, 'Untouched categories changed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a AND month_date = '2026-08-01');
  SELECT * INTO STRICT revision FROM public.financial_data_revisions WHERE user_id = account_a;
  ASSERT revision.months_snapshot = baseline->'months' AND revision.categories_snapshot = baseline->'categories';
  ASSERT revision.operation_mode = 'update_months' AND revision.source_data_version = 'mode-source/opaque';
  ASSERT (SELECT business_name = 'Mode fixture' AND min_cash_reserve = 77 AND burn_rate_warning_pct = 0.105
    FROM public.business_profiles WHERE user_id = account_a), 'Account settings changed';

  -- An older upload must not move the resulting latest-month summary backward.
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.import_financial_data(account_a,
    '[{"month_date":"2026-07-01","closing_cash":1000}]','{}','mode-older.xlsx','update_months');
  EXECUTE 'RESET ROLE';
  ASSERT result->'months_total' = '4'::jsonb AND result->>'date_to' = '2026-10-01'
    AND result->'current_cash' = '70'::jsonb;

  -- Snapshot/history/version/categories/current data must all roll back in BOTH modes.
  baseline := pg_temp.mode_snapshot(account_a);
  FOREACH requested_mode IN ARRAY ARRAY['update_months','replace_all'] LOOP
    PERFORM set_config('elidan.mode_verify_fail','on',true);
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.import_financial_data(account_a,
        '[{"month_date":"2026-09-01","closing_cash":999}]','{}','mode-failure.xlsx',requested_mode);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Forced mode verification audit failure' THEN RAISE; END IF;
      denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied;
    ASSERT pg_temp.mode_snapshot(account_a) = baseline, 'Late failure left partial changes';
  END LOOP;
  PERFORM set_config('elidan.mode_verify_fail','',true);

  FOREACH requested_mode IN ARRAY ARRAY['bogus','',NULL] LOOP
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.import_financial_data(account_a,
        '[{"month_date":"2026-11-01"}]','{}','invalid-mode.xlsx',requested_mode);
    EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied;
    ASSERT pg_temp.mode_snapshot(account_a) = baseline, 'Invalid mode changed data';
  END LOOP;

  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.import_financial_data(account_a,
    '[{"month_date":"2026-11-01","closing_cash":55}]','{}','mode-replace.xlsx','replace_all');
  EXECUTE 'RESET ROLE';
  ASSERT result = '{"mode":"replace_all","replaced":true,"months_imported":1,"months_total":1,"date_from":"2026-11-01","date_to":"2026-11-01","current_cash":55}'::jsonb;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a AND month_date <> '2026-11-01');
  ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
  SELECT * INTO revision FROM public.financial_data_revisions WHERE user_id = account_a ORDER BY id DESC LIMIT 1;
  ASSERT revision.operation_mode = 'replace_all' AND revision.months_snapshot = baseline->'months';

  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.replace_financial_import(account_a,
    '[{"month_date":"2026-12-01","closing_cash":44}]','{}','mode-legacy.xlsx');
  EXECUTE 'RESET ROLE';
  ASSERT result = '{"replaced":true,"months_imported":1}'::jsonb, 'Legacy response contract changed';
  ASSERT (SELECT count(*) FROM public.financial_months WHERE user_id = account_a) = 1;
  ASSERT (SELECT month_date::text FROM public.financial_months WHERE user_id = account_a) = '2026-12-01';
  ASSERT pg_temp.mode_snapshot(account_b) = other_before, 'Another account changed';
  ASSERT pg_temp.mode_snapshot(account_a)->'subscription' = subscription_before, 'Billing changed';
END;
$$;
ROLLBACK;
