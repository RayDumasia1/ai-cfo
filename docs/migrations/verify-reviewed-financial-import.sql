-- PREVIEW ONLY. Never run in production, including on production test accounts.
-- Apply 2026-10-24-reviewed-financial-import.sql first.
-- Run the COMPLETE script through ROLLBACK. On failure run ROLLBACK before retrying.
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
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  IF current_setting('plpgsql.check_asserts') <> 'on' THEN
    RAISE EXCEPTION 'Verification requires plpgsql.check_asserts enabled';
  END IF;
  PERFORM set_config('elidan.review_verify_a',account_a::text,true);
  PERFORM set_config('elidan.review_verify_b',account_b::text,true);
  ASSERT NOT has_function_privilege('anon','public.financial_import_review_state(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.financial_import_review_state(uuid)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)','EXECUTE');
END;
$$;

CREATE FUNCTION pg_temp.review_snapshot(account_id uuid) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'subscription',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

CREATE FUNCTION pg_temp.review_fail_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('elidan.review_verify_fail',true) = 'on'
     AND NEW.user_id = current_setting('elidan.review_verify_a')::uuid THEN
    RAISE EXCEPTION 'Forced reviewed-import audit failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER verify_reviewed_import_audit BEFORE INSERT ON public.data_imports
  FOR EACH ROW EXECUTE FUNCTION pg_temp.review_fail_audit();

DO $$
DECLARE
  account_a uuid := current_setting('elidan.review_verify_a')::uuid;
  account_b uuid := current_setting('elidan.review_verify_b')::uuid;
  absent_account uuid := gen_random_uuid();
  other_before jsonb;
  baseline jsonb;
  state jsonb;
  expected_state text;
  original_timezone text := current_setting('timezone');
  subscription_before jsonb := pg_temp.review_snapshot(account_a)->'subscription';
  result jsonb;
  denied boolean;
  chosen_mode text;
  current_hash text;
BEGIN
  -- Even a missing profile must remain missing when preparing a review.
  baseline := pg_temp.review_snapshot(absent_account);
  EXECUTE 'SET LOCAL ROLE service_role';
  state := public.financial_import_review_state(absent_account);
  EXECUTE 'RESET ROLE';
  ASSERT state->'months' = '[]'::jsonb;
  ASSERT pg_temp.review_snapshot(absent_account) = baseline, 'Read-only preparation created data';

  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_b,'[{"month_date":"2025-08-01","closing_cash":111}]','{}','review-other-seed.xlsx');
  PERFORM public.replace_financial_import(account_b,'[{"month_date":"2025-09-01","closing_cash":222}]','{}','review-other-replace.xlsx');
  PERFORM public.clear_financial_data_preserving_settings(account_a);
  EXECUTE 'RESET ROLE';
  other_before := pg_temp.review_snapshot(account_b);

  -- First upload also works with an empty dataset and null version token.
  UPDATE public.business_profiles SET data_version = NULL WHERE user_id = account_a;
  baseline := pg_temp.review_snapshot(account_a);
  EXECUTE 'SET LOCAL ROLE service_role';
  state := public.financial_import_review_state(account_a);
  EXECUTE 'RESET ROLE';
  ASSERT pg_temp.review_snapshot(account_a) = baseline;
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.import_reviewed_financial_data(account_a,
    '[{"month_date":"2025-08-01","closing_cash":100},{"month_date":"2025-09-01","closing_cash":90}]',
    '{}','review-first.xlsx','update_months',state->>'state_version');
  EXECUTE 'RESET ROLE';
  ASSERT result->'replaced' = 'false'::jsonb AND result->'months_total' = '2'::jsonb;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_data_revisions WHERE user_id = account_a);

  INSERT INTO public.expense_categories (user_id,business_id,month_date,category,amount)
    SELECT account_a,id,'2025-09-01','Review fixture',2 FROM public.business_profiles WHERE user_id = account_a;
  baseline := pg_temp.review_snapshot(account_a);
  EXECUTE 'SET LOCAL ROLE service_role';
  state := public.financial_import_review_state(account_a);
  EXECUTE 'RESET ROLE';
  ASSERT state->'months' = '["2025-08-01","2025-09-01"]'::jsonb;
  ASSERT pg_temp.review_snapshot(account_a) = baseline, 'Review changed financial/profile/audit/history state';
  PERFORM set_config('timezone','America/New_York',true);
  ASSERT public.financial_import_review_state(account_a) = state, 'Review fingerprint depends on session timezone';
  PERFORM set_config('timezone',original_timezone,true);

  -- Account preferences can change during review: commit keeps the newer settings.
  UPDATE public.business_profiles SET min_cash_reserve = 777, burn_rate_warning_pct = 0.105 WHERE user_id = account_a;
  ASSERT public.financial_import_review_state(account_a) = state;
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.import_reviewed_financial_data(account_a,'[{"month_date":"2024-01-01","closing_cash":50}]',
    '{"min_cash_reserve":25000}','review-history.xlsx','update_months',state->>'state_version');
  EXECUTE 'RESET ROLE';
  ASSERT result->'months_total' = '3'::jsonb AND result->>'date_to' = '2025-09-01';
  ASSERT (SELECT min_cash_reserve = 777 AND burn_rate_warning_pct = 0.105 FROM public.business_profiles WHERE user_id = account_a);

  -- The same reviewed state cannot be committed twice.
  baseline := pg_temp.review_snapshot(account_a);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.import_reviewed_financial_data(account_a,'[{"month_date":"2024-01-01","closing_cash":50}]',
      '{}','duplicate-review.xlsx','update_months',state->>'state_version');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'import_review_stale' THEN RAISE; END IF;
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied;
  ASSERT pg_temp.review_snapshot(account_a) = baseline, 'Duplicate confirmation changed data';

  -- A row/category change is detected even without relying on data_version.
  expected_state := public.financial_import_review_state(account_a)->>'state_version';
  UPDATE public.financial_months SET notes = 'Changed since review' WHERE user_id = account_a;
  current_hash := public.financial_import_review_state(account_a)->>'state_version';
  ASSERT current_hash <> expected_state;
  expected_state := current_hash;
  UPDATE public.expense_categories SET amount = amount + 1 WHERE user_id = account_a;
  ASSERT public.financial_import_review_state(account_a)->>'state_version' <> expected_state;

  -- A Clear Data between review and confirmation must not resurrect cleared rows.
  expected_state := public.financial_import_review_state(account_a)->>'state_version';
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.clear_financial_data_preserving_settings(account_a);
  EXECUTE 'RESET ROLE';
  baseline := pg_temp.review_snapshot(account_a);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.import_reviewed_financial_data(account_a,'[{"month_date":"2024-01-01","closing_cash":50}]',
      '{}','cleared-review.xlsx','update_months',expected_state);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'import_review_stale' THEN RAISE; END IF;
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied AND pg_temp.review_snapshot(account_a) = baseline;

  -- Both reviewed modes retain atomic rollback when the final audit fails.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.replace_financial_import(account_a,'[{"month_date":"2025-09-01","closing_cash":90}]','{}','review-reseed.xlsx');
  EXECUTE 'RESET ROLE';
  baseline := pg_temp.review_snapshot(account_a);
  expected_state := public.financial_import_review_state(account_a)->>'state_version';
  FOREACH chosen_mode IN ARRAY ARRAY['update_months','replace_all'] LOOP
    PERFORM set_config('elidan.review_verify_fail','on',true);
    denied := false;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM public.import_reviewed_financial_data(account_a,'[{"month_date":"2024-01-01","closing_cash":50}]',
        '{}','review-fail.xlsx',chosen_mode,expected_state);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Forced reviewed-import audit failure' THEN RAISE; END IF;
      denied := true;
    END;
    EXECUTE 'RESET ROLE';
    ASSERT denied AND pg_temp.review_snapshot(account_a) = baseline;
  END LOOP;
  PERFORM set_config('elidan.review_verify_fail','',true);
  ASSERT pg_temp.review_snapshot(account_b) = other_before, 'Another account changed';
  ASSERT pg_temp.review_snapshot(account_a)->'subscription' = subscription_before, 'Billing changed';
END;
$$;
ROLLBACK;
