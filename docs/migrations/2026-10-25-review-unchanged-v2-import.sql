-- Apply in PREVIEW after 2026-10-25-idempotent-v2-financial-import.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.financial_import_v2_is_unchanged(
  p_user_id uuid,p_months jsonb,p_profile jsonb,p_mode text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_same boolean;
BEGIN
  IF p_user_id IS NULL OR p_mode NOT IN ('update_months','replace_all')
     OR jsonb_typeof(p_months) IS DISTINCT FROM 'array' OR jsonb_array_length(p_months)=0
     OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid financial comparison request' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.business_profiles(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  PERFORM id FROM public.business_profiles WHERE user_id=p_user_id FOR UPDATE;
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_months) AS m(
      month_date date,notes text,accounting_basis text,reporting_currency text,period_status text,
      period_cutoff_date date,opening_included_cash numeric,closing_included_cash numeric,
      closing_unavailable_cash numeric,cash_collected_from_customers numeric,operating_cash_paid numeric,
      owner_draws_paid numeric,debt_principal_paid numeric,debt_interest_paid numeric,
      investing_cash_paid numeric,investing_cash_received numeric,debt_funding_received numeric,
      owner_funding_received numeric,other_cash_inflows numeric,other_cash_outflows numeric,
      closing_taxes_reserved numeric,ar_expected_within_30_days numeric,ap_due_within_30_days numeric,
      available_credit numeric,credit_currently_drawn numeric,lowest_observed_cash numeric)
    LEFT JOIN public.financial_months f ON f.user_id=p_user_id AND f.month_date=m.month_date
    WHERE f.id IS NULL OR ROW(f.opening_cash,f.closing_cash,f.total_revenue,f.total_expenses,
      f.payroll,f.ar_outstanding,f.ap_outstanding,f.notes,f.data_contract_version,f.source_type,
      f.accounting_basis,f.reporting_currency,f.period_status,f.period_cutoff_date,
      f.opening_included_cash,f.closing_included_cash,f.closing_unavailable_cash,
      f.cash_collected_from_customers,f.operating_cash_paid,f.owner_draws_paid,f.debt_principal_paid,
      f.debt_interest_paid,f.investing_cash_paid,f.investing_cash_received,f.debt_funding_received,
      f.owner_funding_received,f.other_cash_inflows,f.other_cash_outflows,f.closing_taxes_reserved,
      f.ar_expected_within_30_days,f.ap_due_within_30_days,f.available_credit,f.credit_currently_drawn,
      f.lowest_observed_cash) IS DISTINCT FROM ROW(m.opening_included_cash,m.closing_included_cash,
      m.cash_collected_from_customers,m.operating_cash_paid+m.owner_draws_paid+m.debt_principal_paid+
      m.debt_interest_paid+m.investing_cash_paid+m.other_cash_outflows,NULL::numeric,NULL::numeric,
      NULL::numeric,m.notes,2::smallint,'spreadsheet'::text,m.accounting_basis,m.reporting_currency,
      m.period_status,m.period_cutoff_date,m.opening_included_cash,m.closing_included_cash,
      m.closing_unavailable_cash,m.cash_collected_from_customers,m.operating_cash_paid,m.owner_draws_paid,
      m.debt_principal_paid,m.debt_interest_paid,m.investing_cash_paid,m.investing_cash_received,
      m.debt_funding_received,m.owner_funding_received,m.other_cash_inflows,m.other_cash_outflows,
      m.closing_taxes_reserved,m.ar_expected_within_30_days,m.ap_due_within_30_days,m.available_credit,
      m.credit_currently_drawn,m.lowest_observed_cash)
  ) INTO v_same;
  RETURN v_same
    AND NOT EXISTS(SELECT 1 FROM public.expense_categories c WHERE c.user_id=p_user_id AND
      (p_mode='replace_all' OR c.month_date IN(SELECT month_date FROM jsonb_to_recordset(p_months) x(month_date date))))
    AND (p_mode<>'replace_all' OR (SELECT count(*) FROM public.financial_months WHERE user_id=p_user_id)=jsonb_array_length(p_months))
    AND NOT EXISTS(SELECT 1 FROM public.business_profiles b WHERE b.user_id=p_user_id
      AND b.onboarding_completed_at IS NULL AND (
        (b.business_name IS NULL AND p_profile?'business_name' AND b.business_name IS DISTINCT FROM p_profile->>'business_name') OR
        (b.industry IS NULL AND p_profile?'industry' AND b.industry IS DISTINCT FROM p_profile->>'industry') OR
        (b.accounting_system IS NULL AND p_profile?'accounting_system' AND b.accounting_system IS DISTINCT FROM p_profile->>'accounting_system') OR
        (b.employee_count IS NULL AND p_profile?'employee_count' AND b.employee_count IS DISTINCT FROM (p_profile->>'employee_count')::integer)));
END; $$;
REVOKE ALL ON FUNCTION public.financial_import_v2_is_unchanged(uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financial_import_v2_is_unchanged(uuid,jsonb,jsonb,text) TO service_role;
COMMIT;
