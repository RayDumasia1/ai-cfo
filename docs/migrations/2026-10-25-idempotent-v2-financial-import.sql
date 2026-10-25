-- Apply in PREVIEW first, after 2026-10-24-v2-financial-import.sql.
-- Makes reviewed v2 imports semantic no-ops when their resulting dataset is unchanged.
BEGIN;

DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run this migration as postgres'; END IF;
  IF to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the v2 financial import migration first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.import_reviewed_financial_data(
  p_user_id uuid,p_months jsonb,p_profile jsonb,p_filename text,
  p_mode text,p_expected_state text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_business_id uuid;
  v_actual_state text;
  v_has_v2 boolean;
  v_has_legacy boolean;
  v_unchanged boolean := false;
  v_total integer;
  v_from text;
  v_to text;
  v_cash numeric;
  v_result jsonb;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('update_months','replace_all')
     OR p_filename IS NULL OR btrim(p_filename)='' THEN
    RAISE EXCEPTION 'Invalid financial import request' USING ERRCODE='22023';
  END IF;
  IF p_user_id IS NULL OR p_expected_state IS NULL OR p_expected_state !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Account and reviewed state are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_months) IS DISTINCT FROM 'array' OR jsonb_array_length(p_months) = 0
     OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid import payload' USING ERRCODE = '22023';
  END IF;
  SELECT bool_or(COALESCE((value->>'data_contract_version')::smallint,1) = 2),
         bool_or(COALESCE((value->>'data_contract_version')::smallint,1) <> 2)
    INTO v_has_v2,v_has_legacy FROM jsonb_array_elements(p_months);
  IF v_has_v2 AND v_has_legacy THEN
    RAISE EXCEPTION 'Mixed financial data contracts are not allowed' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;
  SELECT public.financial_import_review_state(p_user_id)->>'state_version' INTO v_actual_state;
  IF v_actual_state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION 'import_review_stale' USING ERRCODE = 'P0001';
  END IF;
  IF v_has_legacy AND p_mode = 'update_months' AND EXISTS (
    SELECT 1 FROM public.financial_months fm
    WHERE fm.user_id = p_user_id AND fm.data_contract_version = 2
      AND fm.month_date IN (SELECT month_date FROM jsonb_to_recordset(p_months) AS m(month_date date))
  ) THEN
    RAISE EXCEPTION 'Version-1 data cannot overwrite a version-2 month' USING ERRCODE = '22023';
  END IF;

  IF v_has_v2 THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_profile) AS k(key)
      WHERE key NOT IN ('business_name','industry','accounting_system','employee_count',
        'min_cash_reserve','runway_warning_threshold','runway_danger_threshold',
        'burn_rate_warning_pct','invoice_overdue_days'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_months) AS m(value),
      LATERAL jsonb_object_keys(m.value) AS k(key) WHERE key NOT IN (
        'month_date','opening_cash','closing_cash','total_revenue','total_expenses',
        'payroll','ar_outstanding','ap_outstanding','notes','data_contract_version',
        'source_type','accounting_basis','reporting_currency','period_status',
        'period_cutoff_date','opening_included_cash','closing_included_cash',
        'closing_unavailable_cash','cash_collected_from_customers','operating_cash_paid',
        'owner_draws_paid','debt_principal_paid','debt_interest_paid','investing_cash_paid',
        'investing_cash_received','debt_funding_received','owner_funding_received',
        'other_cash_inflows','other_cash_outflows','closing_taxes_reserved',
        'ar_expected_within_30_days','ap_due_within_30_days','available_credit',
        'credit_currently_drawn','lowest_observed_cash'))
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_months) AS m(
      month_date date,data_contract_version smallint,source_type text,accounting_basis text,
      reporting_currency text,period_status text,opening_included_cash numeric,
      closing_included_cash numeric,closing_unavailable_cash numeric,
      cash_collected_from_customers numeric,operating_cash_paid numeric,owner_draws_paid numeric,
      debt_principal_paid numeric,debt_interest_paid numeric,investing_cash_paid numeric,
      investing_cash_received numeric,debt_funding_received numeric,owner_funding_received numeric,
      other_cash_inflows numeric,other_cash_outflows numeric)
      WHERE m.month_date IS NULL OR extract(day FROM m.month_date)<>1
        OR m.data_contract_version IS DISTINCT FROM 2 OR m.source_type IS DISTINCT FROM 'spreadsheet'
        OR m.accounting_basis IS NULL OR m.reporting_currency IS NULL
        OR m.period_status NOT IN ('complete','partial') OR m.opening_included_cash IS NULL
        OR m.closing_included_cash IS NULL OR m.closing_unavailable_cash IS NULL
        OR m.cash_collected_from_customers IS NULL OR m.operating_cash_paid IS NULL
        OR m.owner_draws_paid IS NULL OR m.debt_principal_paid IS NULL
        OR m.debt_interest_paid IS NULL OR m.investing_cash_paid IS NULL
        OR m.investing_cash_received IS NULL OR m.debt_funding_received IS NULL
        OR m.owner_funding_received IS NULL OR m.other_cash_inflows IS NULL
        OR m.other_cash_outflows IS NULL
        OR abs(m.closing_included_cash-m.opening_included_cash-(m.cash_collected_from_customers-
          m.operating_cash_paid-m.owner_draws_paid-m.debt_principal_paid-m.debt_interest_paid-
          m.investing_cash_paid+m.investing_cash_received+m.debt_funding_received+
          m.owner_funding_received+m.other_cash_inflows-m.other_cash_outflows))>1)
    OR (SELECT count(DISTINCT month_date) FROM jsonb_to_recordset(p_months) AS m(month_date date))
       <> jsonb_array_length(p_months) THEN
      RAISE EXCEPTION 'Invalid version-2 financial months' USING ERRCODE='22023';
    END IF;

    -- Every uploaded month must already equal the exact row the v2 engine would
    -- store. Null-safe row comparison preserves unknown-versus-zero semantics.
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_months) AS m(
        month_date date,notes text,accounting_basis text,reporting_currency text,
        period_status text,period_cutoff_date date,opening_included_cash numeric,
        closing_included_cash numeric,closing_unavailable_cash numeric,
        cash_collected_from_customers numeric,operating_cash_paid numeric,
        owner_draws_paid numeric,debt_principal_paid numeric,debt_interest_paid numeric,
        investing_cash_paid numeric,investing_cash_received numeric,
        debt_funding_received numeric,owner_funding_received numeric,
        other_cash_inflows numeric,other_cash_outflows numeric,closing_taxes_reserved numeric,
        ar_expected_within_30_days numeric,ap_due_within_30_days numeric,
        available_credit numeric,credit_currently_drawn numeric,lowest_observed_cash numeric
      )
      LEFT JOIN public.financial_months f ON f.user_id=p_user_id AND f.month_date=m.month_date
      WHERE f.id IS NULL OR ROW(
        f.opening_cash,f.closing_cash,f.total_revenue,f.total_expenses,f.payroll,
        f.ar_outstanding,f.ap_outstanding,f.notes,f.data_contract_version,f.source_type,
        f.accounting_basis,f.reporting_currency,f.period_status,f.period_cutoff_date,
        f.opening_included_cash,f.closing_included_cash,f.closing_unavailable_cash,
        f.cash_collected_from_customers,f.operating_cash_paid,f.owner_draws_paid,
        f.debt_principal_paid,f.debt_interest_paid,f.investing_cash_paid,
        f.investing_cash_received,f.debt_funding_received,f.owner_funding_received,
        f.other_cash_inflows,f.other_cash_outflows,f.closing_taxes_reserved,
        f.ar_expected_within_30_days,f.ap_due_within_30_days,f.available_credit,
        f.credit_currently_drawn,f.lowest_observed_cash
      ) IS DISTINCT FROM ROW(
        m.opening_included_cash,m.closing_included_cash,m.cash_collected_from_customers,
        m.operating_cash_paid+m.owner_draws_paid+m.debt_principal_paid+m.debt_interest_paid+
          m.investing_cash_paid+m.other_cash_outflows,NULL::numeric,NULL::numeric,NULL::numeric,
        m.notes,2::smallint,'spreadsheet'::text,m.accounting_basis,m.reporting_currency,
        m.period_status,m.period_cutoff_date,m.opening_included_cash,m.closing_included_cash,
        m.closing_unavailable_cash,m.cash_collected_from_customers,m.operating_cash_paid,
        m.owner_draws_paid,m.debt_principal_paid,m.debt_interest_paid,m.investing_cash_paid,
        m.investing_cash_received,m.debt_funding_received,m.owner_funding_received,
        m.other_cash_inflows,m.other_cash_outflows,m.closing_taxes_reserved,
        m.ar_expected_within_30_days,m.ap_due_within_30_days,m.available_credit,
        m.credit_currently_drawn,m.lowest_observed_cash
      )
    ) INTO v_unchanged;

    v_unchanged := v_unchanged
      AND NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.user_id=p_user_id
        AND (p_mode='replace_all' OR c.month_date IN
          (SELECT month_date FROM jsonb_to_recordset(p_months) AS m(month_date date))))
      AND (p_mode <> 'replace_all' OR
        (SELECT count(*) FROM public.financial_months WHERE user_id=p_user_id)=jsonb_array_length(p_months))
      AND NOT EXISTS (
        SELECT 1 FROM public.business_profiles bp WHERE bp.user_id=p_user_id
          AND bp.onboarding_completed_at IS NULL AND (
            (bp.business_name IS NULL AND p_profile ? 'business_name' AND
              bp.business_name IS DISTINCT FROM p_profile->>'business_name') OR
            (bp.industry IS NULL AND p_profile ? 'industry' AND
              bp.industry IS DISTINCT FROM p_profile->>'industry') OR
            (bp.accounting_system IS NULL AND p_profile ? 'accounting_system' AND
              bp.accounting_system IS DISTINCT FROM p_profile->>'accounting_system') OR
            (bp.employee_count IS NULL AND p_profile ? 'employee_count' AND
              bp.employee_count IS DISTINCT FROM (p_profile->>'employee_count')::integer)
          )
      );

    IF v_unchanged THEN
      SELECT count(*),min(month_date::text),max(month_date::text) INTO v_total,v_from,v_to
        FROM public.financial_months WHERE user_id=p_user_id;
      SELECT COALESCE(closing_included_cash,closing_cash) INTO v_cash
        FROM public.financial_months WHERE user_id=p_user_id AND month_date::text=v_to;
      RETURN jsonb_build_object('unchanged',true,'replaced',v_total>0,'months_imported',0,
        'mode',p_mode,'months_total',v_total,'date_from',v_from,'date_to',v_to,'current_cash',v_cash);
    END IF;
    v_result := public.import_financial_data_v2(p_user_id,p_months,p_profile,p_filename,p_mode);
  ELSE
    v_result := public.import_financial_data(p_user_id,p_months,p_profile,p_filename,p_mode);
  END IF;
  RETURN v_result || jsonb_build_object('unchanged',false);
END;
$$;

REVOKE ALL ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)
  TO service_role;
COMMENT ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) IS
  'Server-only reviewed import. Under the account lock, v2 semantic duplicates return unchanged without revisions, audits, versions or financial writes.';

COMMIT;
