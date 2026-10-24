-- PREVIEW ONLY. Never run in production, including on production test accounts.
-- Run after preserve-settings-on-financial-clear and financial-import-modes migrations.
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
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both preview test accounts must exist';
  END IF;
  IF current_setting('plpgsql.check_asserts') <> 'on' THEN
    RAISE EXCEPTION 'Verification requires plpgsql.check_asserts enabled';
  END IF;
  IF to_regprocedure('public.import_financial_data(uuid,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the financial import-modes migration before this verification';
  END IF;
  PERFORM set_config('elidan.keep_settings_a',account_a::text,true);
  PERFORM set_config('elidan.keep_settings_b',account_b::text,true);
  ASSERT NOT has_function_privilege('anon','public.clear_financial_data_preserving_settings(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.clear_financial_data_preserving_settings(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.clear_financial_data(uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.clear_financial_data_preserving_settings(uuid)','EXECUTE');
END;
$$;

CREATE FUNCTION pg_temp.keep_settings_snapshot(account_id uuid) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'revisions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'imports', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'subscription', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

CREATE FUNCTION pg_temp.keep_settings_fail() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  failure_mode text := current_setting('elidan.keep_settings_fail',true);
  affected_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN affected_user := OLD.user_id; ELSE affected_user := NEW.user_id; END IF;
  IF affected_user = current_setting('elidan.keep_settings_a')::uuid AND (
    (failure_mode = 'purge' AND TG_OP = 'DELETE') OR
    (failure_mode = 'audit' AND TG_OP = 'INSERT')
  ) THEN
    RAISE EXCEPTION 'Forced preserving-clear failure: %',failure_mode;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_keep_settings_purge BEFORE DELETE ON public.financial_data_revisions
  FOR EACH ROW EXECUTE FUNCTION pg_temp.keep_settings_fail();
CREATE TRIGGER verify_keep_settings_audit BEFORE INSERT ON public.data_imports
  FOR EACH ROW EXECUTE FUNCTION pg_temp.keep_settings_fail();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.keep_settings_a')::uuid;
  account_b uuid := current_setting('elidan.keep_settings_b')::uuid;
  subscription_before jsonb := pg_temp.keep_settings_snapshot(account_a)->'subscription';
  other_before jsonb;
  baseline jsonb;
  reserve_value jsonb;
  failure_mode text;
  import_mode text;
  denied boolean;
  audit_count integer;
  result jsonb;
BEGIN
  -- Seed both current data and history in B so broad deletes cannot pass unnoticed.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_b,'[{"month_date":"2026-08-01","closing_cash":111}]','{}','keep-other-seed.xlsx');
  PERFORM public.replace_financial_import(account_b,'[{"month_date":"2026-09-01","closing_cash":222}]','{}','keep-other-replace.xlsx');
  EXECUTE 'RESET ROLE';
  other_before := pg_temp.keep_settings_snapshot(account_b);

  FOR reserve_value IN SELECT value FROM jsonb_array_elements('[1250.5,0,null]'::jsonb) LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.replace_financial_import(account_a,'[{"month_date":"2026-08-01","closing_cash":100}]','{}','keep-seed.xlsx');
    PERFORM public.replace_financial_import(account_a,'[{"month_date":"2026-09-01","closing_cash":90}]','{}','keep-replace.xlsx');
    EXECUTE 'RESET ROLE';
    INSERT INTO public.expense_categories (user_id,business_id,month_date,category,amount)
      SELECT account_a,id,'2026-09-01','Preserving clear fixture',2 FROM public.business_profiles WHERE user_id = account_a;
    UPDATE public.business_profiles SET min_cash_reserve = (reserve_value #>> '{}')::numeric,
      runway_warning_threshold = 9, runway_danger_threshold = 4, burn_rate_warning_pct = 0.105,
      invoice_overdue_days = 45, data_version = '2000-01-01T00:00:00Z'
      WHERE user_id = account_a;
    ASSERT (SELECT min_cash_reserve IS NOT DISTINCT FROM (reserve_value #>> '{}')::numeric
      AND runway_warning_threshold = 9 AND runway_danger_threshold = 4
      AND burn_rate_warning_pct = 0.105 AND invoice_overdue_days = 45
      FROM public.business_profiles WHERE user_id = account_a),
      'Fixture precision was lost before the clear';
    baseline := pg_temp.keep_settings_snapshot(account_a);

    FOREACH failure_mode IN ARRAY ARRAY['purge','audit'] LOOP
      PERFORM set_config('elidan.keep_settings_fail',failure_mode,true);
      denied := false;
      BEGIN
        EXECUTE 'SET LOCAL ROLE service_role';
        PERFORM public.clear_financial_data_preserving_settings(account_a);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> ('Forced preserving-clear failure: ' || failure_mode) THEN RAISE; END IF;
        denied := true;
      END;
      EXECUTE 'RESET ROLE';
      ASSERT denied, 'Expected failure did not occur';
      ASSERT pg_temp.keep_settings_snapshot(account_a) = baseline, 'Failure left partial financial/history/settings changes';
    END LOOP;
    PERFORM set_config('elidan.keep_settings_fail','',true);
    SELECT count(*) INTO audit_count FROM public.data_imports WHERE user_id = account_a;
    EXECUTE 'SET LOCAL ROLE service_role';
    result := public.clear_financial_data_preserving_settings(account_a);
    EXECUTE 'RESET ROLE';
    ASSERT result = '{"cleared":true}'::jsonb;
    ASSERT NOT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = account_a);
    ASSERT NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = account_a);
    ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a);
    ASSERT (pg_temp.keep_settings_snapshot(account_a)->'profile'->0) - ARRAY['data_version','updated_at']
      = (baseline->'profile'->0) - ARRAY['data_version','updated_at'], 'Clear changed account settings/details';
    ASSERT (SELECT data_version::text FROM public.business_profiles WHERE user_id = account_a)
      IS DISTINCT FROM '2000-01-01T00:00:00Z';
    ASSERT (SELECT count(*) FROM public.data_imports WHERE user_id = account_a) = audit_count + 1;

    -- The legacy function and repeated clears must keep preferences too.
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.clear_financial_data(account_a);
    FOREACH import_mode IN ARRAY ARRAY['update_months','replace_all'] LOOP
      PERFORM public.import_financial_data(account_a,
        '[{"month_date":"2026-10-01","closing_cash":80}]',
        '{"min_cash_reserve":25000,"runway_warning_threshold":6,"burn_rate_warning_pct":0.1}',
        'keep-reimport.xlsx',import_mode);
    END LOOP;
    EXECUTE 'RESET ROLE';
    ASSERT (pg_temp.keep_settings_snapshot(account_a)->'profile'->0) - ARRAY['data_version','updated_at']
      = (baseline->'profile'->0) - ARRAY['data_version','updated_at'], 'Repeated clear or reimport changed settings';
    ASSERT pg_temp.keep_settings_snapshot(account_b) = other_before, 'Another account changed';
    ASSERT pg_temp.keep_settings_snapshot(account_a)->'subscription' = subscription_before, 'Billing changed';
  END LOOP;

  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.clear_financial_data_preserving_settings(NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied, 'Null account accepted';
END;
$$;
ROLLBACK;
