-- PREVIEW ONLY. Never run in production, including on production test accounts.
-- Apply 2026-10-24-v2-financial-import.sql first.
-- Run the COMPLETE script through ROLLBACK. It leaves no verification data.
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
  IF to_regprocedure('public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the v2 financial import migration first';
  END IF;
  ASSERT NOT has_function_privilege('anon','public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)','EXECUTE');
  PERFORM set_config('elidan.v2_verify_a',account_a::text,true);
  PERFORM set_config('elidan.v2_verify_b',account_b::text,true);
END;
$$;

CREATE FUNCTION pg_temp.v2_snapshot(account_id uuid) RETURNS jsonb LANGUAGE sql SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.business_profiles t WHERE user_id = account_id),
    'months',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE user_id = account_id),
    'categories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE user_id = account_id),
    'imports',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE user_id = account_id),
    'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE user_id = account_id),
    'subscription',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.user_id) FROM public.subscriptions t WHERE user_id = account_id)
  );
$$;

DO $$
DECLARE
  account_a uuid := current_setting('elidan.v2_verify_a')::uuid;
  account_b uuid := current_setting('elidan.v2_verify_b')::uuid;
  other_before jsonb := pg_temp.v2_snapshot(account_b);
  before_failed jsonb;
  state text;
  result jsonb;
  payload jsonb := jsonb_build_array(jsonb_build_object(
    'month_date','2026-01-01','data_contract_version',2,'source_type','spreadsheet',
    'accounting_basis','cash','reporting_currency','USD','period_status','complete',
    'period_cutoff_date',NULL,'opening_cash',100000,'closing_cash',110000,
    'total_revenue',75000,'total_expenses',75000,'payroll',NULL,
    'ar_outstanding',NULL,'ap_outstanding',NULL,'notes','v2 verification',
    'opening_included_cash',100000,'closing_included_cash',110000,
    'closing_unavailable_cash',12000,'cash_collected_from_customers',75000,
    'operating_cash_paid',60000,'owner_draws_paid',3000,'debt_principal_paid',2000,
    'debt_interest_paid',500,'investing_cash_paid',8000,'investing_cash_received',0,
    'debt_funding_received',0,'owner_funding_received',10000,
    'other_cash_inflows',0,'other_cash_outflows',1500,'closing_taxes_reserved',5000,
    'ar_expected_within_30_days',18000,'ap_due_within_30_days',14000,
    'available_credit',50000,'credit_currently_drawn',10000,'lowest_observed_cash',82000
  ));
  bad_payload jsonb;
  denied boolean;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.clear_financial_data_preserving_settings(account_a);
  state := public.financial_import_review_state(account_a)->>'state_version';
  result := public.import_reviewed_financial_data(account_a,payload,
    '{}','v2-verification.xlsx','update_months',state);
  EXECUTE 'RESET ROLE';

  ASSERT result->'months_imported' = '1'::jsonb AND result->'months_total' = '1'::jsonb;
  ASSERT result->'current_cash' = '110000'::jsonb;
  ASSERT (SELECT data_contract_version = 2 AND source_type = 'spreadsheet'
      AND accounting_basis = 'cash' AND reporting_currency = 'USD'
      AND opening_cash = 100000 AND closing_cash = 110000
      AND total_revenue = 75000 AND total_expenses = 75000
      AND closing_unavailable_cash = 12000 AND closing_taxes_reserved = 5000
      AND cash_reconciliation_difference = 0
    FROM public.financial_months WHERE user_id = account_a AND month_date = '2026-01-01');

  -- A materially unreconciled payload must fail without changing any table.
  before_failed := pg_temp.v2_snapshot(account_a);
  bad_payload := jsonb_set(payload,'{0,closing_included_cash}','111500'::jsonb);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.import_financial_data_v2(account_a,bad_payload,'{}','bad-v2.xlsx','update_months');
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied AND pg_temp.v2_snapshot(account_a) = before_failed;

  -- A stale reviewed state cannot commit, and another account is untouched.
  state := public.financial_import_review_state(account_a)->>'state_version';
  UPDATE public.financial_months SET notes = 'changed after review'
    WHERE user_id = account_a AND month_date = '2026-01-01';
  before_failed := pg_temp.v2_snapshot(account_a);
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.import_reviewed_financial_data(account_a,payload,'{}','stale-v2.xlsx','update_months',state);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'import_review_stale' THEN RAISE; END IF;
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied AND pg_temp.v2_snapshot(account_a) = before_failed;
  ASSERT pg_temp.v2_snapshot(account_b) = other_before;

  -- Version-1 update mode cannot leave a hybrid row by overwriting v2 fields.
  state := public.financial_import_review_state(account_a)->>'state_version';
  denied := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM public.import_reviewed_financial_data(account_a,
      '[{"month_date":"2026-01-01","opening_cash":1,"closing_cash":1,"total_revenue":1,"total_expenses":1}]',
      '{}','legacy-over-v2.xlsx','update_months',state);
  EXCEPTION WHEN invalid_parameter_value THEN
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  ASSERT denied;
END;
$$;

ROLLBACK;
