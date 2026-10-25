-- PREVIEW ONLY. Never run in production.
-- Replace both UUIDs, set preview_confirmed true, and run as postgres.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  account_a uuid := NULL;
  account_b uuid := NULL;
  month_payload jsonb := '[{"month_date":"2099-01-01","notes":"same","data_contract_version":2,"source_type":"spreadsheet","accounting_basis":"cash","reporting_currency":"USD","period_status":"complete","period_cutoff_date":null,"opening_included_cash":100,"closing_included_cash":110,"closing_unavailable_cash":0,"cash_collected_from_customers":20,"operating_cash_paid":10,"owner_draws_paid":0,"debt_principal_paid":0,"debt_interest_paid":0,"investing_cash_paid":0,"investing_cash_received":0,"debt_funding_received":0,"owner_funding_received":0,"other_cash_inflows":0,"other_cash_outflows":0,"closing_taxes_reserved":0,"ar_expected_within_30_days":0,"ap_due_within_30_days":0,"available_credit":0,"credit_currently_drawn":0,"lowest_observed_cash":100}]';
  state text;
  result jsonb;
  before_snapshot jsonb;
  after_snapshot jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed OR account_a IS NULL
     OR account_b IS NULL OR account_a=account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(account_a,account_b)) <> 2 THEN
    RAISE EXCEPTION 'Both dedicated preview accounts must exist';
  END IF;

  PERFORM public.import_financial_data_v2(account_a,month_payload,'{}','idempotent-seed.xlsx','replace_all');
  SELECT jsonb_build_object(
    'profile',(SELECT to_jsonb(p) FROM public.business_profiles p WHERE p.user_id=account_a),
    'months',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.financial_months m WHERE m.user_id=account_a),
    'categories',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.expense_categories c WHERE c.user_id=account_a),
    'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.financial_data_revisions r WHERE r.user_id=account_a),
    'imports',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.data_imports i WHERE i.user_id=account_a)
  ) INTO before_snapshot;

  state := public.financial_import_review_state(account_a)->>'state_version';
  result := public.import_reviewed_financial_data(account_a,month_payload,'{}','renamed-copy.xlsx','update_months',state);
  ASSERT result @> '{"unchanged":true,"months_imported":0,"months_total":1}'::jsonb;
  state := public.financial_import_review_state(account_a)->>'state_version';
  result := public.import_reviewed_financial_data(account_a,month_payload,'{}','formatted-copy.xlsx','replace_all',state);
  ASSERT result @> '{"unchanged":true,"months_imported":0,"months_total":1}'::jsonb;

  SELECT jsonb_build_object(
    'profile',(SELECT to_jsonb(p) FROM public.business_profiles p WHERE p.user_id=account_a),
    'months',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.financial_months m WHERE m.user_id=account_a),
    'categories',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.expense_categories c WHERE c.user_id=account_a),
    'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.financial_data_revisions r WHERE r.user_id=account_a),
    'imports',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.data_imports i WHERE i.user_id=account_a)
  ) INTO after_snapshot;
  ASSERT after_snapshot=before_snapshot, 'An unchanged import mutated current data, history, version, or audit rows';

  state := public.financial_import_review_state(account_a)->>'state_version';
  result := public.import_reviewed_financial_data(account_a,
    jsonb_set(month_payload,'{0,notes}','"changed"'::jsonb),'{}','changed.xlsx','update_months',state);
  ASSERT result @> '{"unchanged":false,"months_imported":1}'::jsonb;
  ASSERT (SELECT notes FROM public.financial_months WHERE user_id=account_a AND month_date='2099-01-01')='changed';
  ASSERT (SELECT count(*) FROM public.financial_data_revisions WHERE user_id=account_a) >
    COALESCE(jsonb_array_length(before_snapshot->'revisions'),0);
END;
$$;
ROLLBACK;
