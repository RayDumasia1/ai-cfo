-- PREVIEW ONLY. Run while verify-db01a-financial-lock-session-a.sql is sleeping.
-- Replace both NULLs, set preview_confirmed := true, and run as postgres.
-- Both accounts must be dedicated preview fixtures. Every probe must time out.
BEGIN;

DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL; -- same locked account used in session A
  account_b uuid := NULL; -- distinct preview account used to verify isolation
  account_b_before jsonb;
  account_b_after jsonb;
  timed_out boolean;
  payload jsonb := jsonb_build_array(jsonb_build_object(
    'month_date','2026-01-01','data_contract_version',2,'source_type','spreadsheet',
    'accounting_basis','cash','reporting_currency','USD','period_status','complete',
    'period_cutoff_date',NULL,'opening_cash',100000,'closing_cash',110000,
    'total_revenue',75000,'total_expenses',75000,'payroll',NULL,
    'ar_outstanding',NULL,'ap_outstanding',NULL,'notes','DB-01A contention probe',
    'opening_included_cash',100000,'closing_included_cash',110000,
    'closing_unavailable_cash',12000,'cash_collected_from_customers',75000,
    'operating_cash_paid',60000,'owner_draws_paid',3000,'debt_principal_paid',2000,
    'debt_interest_paid',500,'investing_cash_paid',8000,'investing_cash_received',0,
    'debt_funding_received',0,'owner_funding_received',10000,
    'other_cash_inflows',0,'other_cash_outflows',1500,'closing_taxes_reserved',5000,
    'ar_expected_within_30_days',18000,'ap_due_within_30_days',14000,
    'available_credit',50000,'credit_currently_drawn',10000,'lowest_observed_cash',82000
  ));
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a = account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;
  IF to_regprocedure('public.clear_financial_data_preserving_settings(uuid)') IS NULL
     OR to_regprocedure('public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the current financial migrations before DB-01A verification';
  END IF;

  SELECT jsonb_build_object(
    'profile',(SELECT to_jsonb(t) FROM public.business_profiles t WHERE t.user_id = account_b),
    'months',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE t.user_id = account_b),
    'categories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE t.user_id = account_b),
    'imports',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE t.user_id = account_b),
    'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE t.user_id = account_b)
  ) INTO account_b_before;

  PERFORM set_config('lock_timeout','2s',true);
  EXECUTE 'SET LOCAL ROLE service_role';

  timed_out := false;
  BEGIN
    PERFORM public.clear_financial_data_preserving_settings(account_a);
  EXCEPTION WHEN lock_not_available THEN timed_out := true;
  END;
  ASSERT timed_out, 'Clear Data did not wait on the shared profile lock';

  timed_out := false;
  BEGIN
    PERFORM public.import_financial_data_v2(account_a,payload,'{}','db01a.xlsx','update_months');
  EXCEPTION WHEN lock_not_available THEN timed_out := true;
  END;
  ASSERT timed_out, 'Financial import did not wait on the shared profile lock';

  timed_out := false;
  BEGIN
    PERFORM public.import_reviewed_financial_data(
      account_a,payload,'{}','db01a-reviewed.xlsx','update_months',repeat('0',32)
    );
  EXCEPTION WHEN lock_not_available THEN timed_out := true;
  END;
  ASSERT timed_out, 'Reviewed confirmation did not wait on the shared profile lock';

  EXECUTE 'RESET ROLE';
  SELECT jsonb_build_object(
    'profile',(SELECT to_jsonb(t) FROM public.business_profiles t WHERE t.user_id = account_b),
    'months',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_months t WHERE t.user_id = account_b),
    'categories',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.expense_categories t WHERE t.user_id = account_b),
    'imports',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.data_imports t WHERE t.user_id = account_b),
    'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.financial_data_revisions t WHERE t.user_id = account_b)
  ) INTO account_b_after;
  ASSERT account_b_after = account_b_before, 'The unrelated preview account changed';
END;
$$;

SELECT 'PASS: import, reviewed confirmation, and Clear Data share the account profile lock.' AS result;
ROLLBACK;

