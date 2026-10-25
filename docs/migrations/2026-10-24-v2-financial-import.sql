-- PREVIEW first, after financial-data-contract-v2 and reviewed-financial-import.
-- Adds a strict version-2 import engine and dispatches reviewed imports by a
-- homogeneous contract version. Existing version-1 import behavior is unchanged.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.import_financial_data(uuid,jsonb,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.financial_months'::regclass
         AND attname = 'data_contract_version' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Apply the reviewed import and financial data contract v2 migrations first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_financial_data_v2(
  p_user_id uuid,
  p_months jsonb,
  p_profile jsonb,
  p_filename text,
  p_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_business_id uuid;
  v_profile public.business_profiles%ROWTYPE;
  v_replaced boolean;
  v_count integer;
  v_version timestamptz;
  v_total integer;
  v_from text;
  v_to text;
  v_cash numeric;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('update_months','replace_all') THEN
    RAISE EXCEPTION 'Invalid financial import mode' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_filename IS NULL OR btrim(p_filename) = '' THEN
    RAISE EXCEPTION 'Account and filename are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_months) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid import payload' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_months);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Import must contain at least one month' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_profile) AS k(key)
    WHERE key NOT IN ('business_name','industry','accounting_system','employee_count',
      'min_cash_reserve','runway_warning_threshold','runway_danger_threshold',
      'burn_rate_warning_pct','invoice_overdue_days')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_months) AS m(value),
      LATERAL jsonb_object_keys(m.value) AS k(key)
    WHERE key NOT IN (
      'month_date','opening_cash','closing_cash','total_revenue','total_expenses',
      'payroll','ar_outstanding','ap_outstanding','notes','data_contract_version',
      'source_type','accounting_basis','reporting_currency','period_status',
      'period_cutoff_date','opening_included_cash','closing_included_cash',
      'closing_unavailable_cash','cash_collected_from_customers','operating_cash_paid',
      'owner_draws_paid','debt_principal_paid','debt_interest_paid','investing_cash_paid',
      'investing_cash_received','debt_funding_received','owner_funding_received',
      'other_cash_inflows','other_cash_outflows','closing_taxes_reserved',
      'ar_expected_within_30_days','ap_due_within_30_days','available_credit',
      'credit_currently_drawn','lowest_observed_cash'
    )
  ) THEN
    RAISE EXCEPTION 'Unexpected import fields' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_months) AS m(
      month_date date, data_contract_version smallint, source_type text,
      accounting_basis text, reporting_currency text, period_status text,
      period_cutoff_date date, opening_included_cash numeric,
      closing_included_cash numeric, closing_unavailable_cash numeric,
      cash_collected_from_customers numeric, operating_cash_paid numeric,
      owner_draws_paid numeric, debt_principal_paid numeric, debt_interest_paid numeric,
      investing_cash_paid numeric, investing_cash_received numeric,
      debt_funding_received numeric, owner_funding_received numeric,
      other_cash_inflows numeric, other_cash_outflows numeric
    )
    WHERE m.month_date IS NULL OR extract(day FROM m.month_date) <> 1
      OR m.data_contract_version IS DISTINCT FROM 2
      OR m.source_type IS DISTINCT FROM 'spreadsheet'
      OR m.accounting_basis IS NULL OR m.reporting_currency IS NULL
      OR m.period_status IS NULL OR m.period_status NOT IN ('complete','partial')
      OR m.opening_included_cash IS NULL OR m.closing_included_cash IS NULL
      OR m.closing_unavailable_cash IS NULL OR m.cash_collected_from_customers IS NULL
      OR m.operating_cash_paid IS NULL OR m.owner_draws_paid IS NULL
      OR m.debt_principal_paid IS NULL OR m.debt_interest_paid IS NULL
      OR m.investing_cash_paid IS NULL OR m.investing_cash_received IS NULL
      OR m.debt_funding_received IS NULL OR m.owner_funding_received IS NULL
      OR m.other_cash_inflows IS NULL OR m.other_cash_outflows IS NULL
      OR abs(m.closing_included_cash - m.opening_included_cash - (
        m.cash_collected_from_customers - m.operating_cash_paid - m.owner_draws_paid
        - m.debt_principal_paid - m.debt_interest_paid - m.investing_cash_paid
        + m.investing_cash_received + m.debt_funding_received + m.owner_funding_received
        + m.other_cash_inflows - m.other_cash_outflows
      )) > 1
  ) OR (SELECT count(DISTINCT month_date)
        FROM jsonb_to_recordset(p_months) AS m(month_date date)) <> v_count THEN
    RAISE EXCEPTION 'Invalid version-2 financial months' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = p_user_id)
    INTO v_replaced;

  IF v_replaced OR EXISTS (SELECT 1 FROM public.expense_categories WHERE user_id = p_user_id) THEN
    INSERT INTO public.financial_data_revisions (
      user_id, source_data_version, replaced_by_filename, operation_mode,
      profile_snapshot, months_snapshot, categories_snapshot
    )
    SELECT p_user_id, bp.data_version, p_filename, p_mode,
      jsonb_build_object(
        'business_name', bp.business_name, 'industry', bp.industry,
        'accounting_system', bp.accounting_system, 'employee_count', bp.employee_count,
        'min_cash_reserve', bp.min_cash_reserve,
        'runway_warning_threshold', bp.runway_warning_threshold,
        'runway_danger_threshold', bp.runway_danger_threshold,
        'burn_rate_warning_pct', bp.burn_rate_warning_pct,
        'invoice_overdue_days', bp.invoice_overdue_days
      ),
      COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month_date,m.id)
        FROM public.financial_months m WHERE m.user_id = p_user_id),'[]'::jsonb),
      COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.month_date,c.id)
        FROM public.expense_categories c WHERE c.user_id = p_user_id),'[]'::jsonb)
    FROM public.business_profiles bp WHERE bp.user_id = p_user_id;

    DELETE FROM public.financial_data_revisions
    WHERE user_id = p_user_id AND id IN (
      SELECT id FROM public.financial_data_revisions WHERE user_id = p_user_id
      ORDER BY id DESC OFFSET 20
    );
  END IF;

  v_profile := jsonb_populate_record(NULL::public.business_profiles,
    p_profile - ARRAY['min_cash_reserve','runway_warning_threshold','runway_danger_threshold',
      'burn_rate_warning_pct','invoice_overdue_days']);
  UPDATE public.business_profiles AS bp SET
    business_name = CASE WHEN bp.onboarding_completed_at IS NULL AND bp.business_name IS NULL
      AND p_profile ? 'business_name' THEN v_profile.business_name ELSE bp.business_name END,
    industry = CASE WHEN bp.onboarding_completed_at IS NULL AND bp.industry IS NULL
      AND p_profile ? 'industry' THEN v_profile.industry ELSE bp.industry END,
    accounting_system = CASE WHEN bp.onboarding_completed_at IS NULL AND bp.accounting_system IS NULL
      AND p_profile ? 'accounting_system' THEN v_profile.accounting_system ELSE bp.accounting_system END,
    employee_count = CASE WHEN bp.onboarding_completed_at IS NULL AND bp.employee_count IS NULL
      AND p_profile ? 'employee_count' THEN v_profile.employee_count ELSE bp.employee_count END
  WHERE bp.user_id = p_user_id;

  DELETE FROM public.expense_categories WHERE user_id = p_user_id
    AND (p_mode = 'replace_all' OR month_date::text IN (
      SELECT m.month_date::text FROM jsonb_to_recordset(p_months) AS m(month_date date)
    ));
  IF p_mode = 'replace_all' THEN
    DELETE FROM public.financial_months WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.financial_months (
    user_id,business_id,month_date,opening_cash,closing_cash,total_revenue,total_expenses,
    payroll,ar_outstanding,ap_outstanding,notes,data_contract_version,source_type,
    accounting_basis,reporting_currency,period_status,period_cutoff_date,
    opening_included_cash,closing_included_cash,closing_unavailable_cash,
    cash_collected_from_customers,operating_cash_paid,owner_draws_paid,
    debt_principal_paid,debt_interest_paid,investing_cash_paid,investing_cash_received,
    debt_funding_received,owner_funding_received,other_cash_inflows,other_cash_outflows,
    closing_taxes_reserved,ar_expected_within_30_days,ap_due_within_30_days,
    available_credit,credit_currently_drawn,lowest_observed_cash
  )
  SELECT p_user_id,v_business_id,m.month_date,m.opening_included_cash,m.closing_included_cash,
    m.cash_collected_from_customers,
    m.operating_cash_paid + m.owner_draws_paid + m.debt_principal_paid
      + m.debt_interest_paid + m.investing_cash_paid + m.other_cash_outflows,
    NULL,NULL,NULL,m.notes,2,'spreadsheet',m.accounting_basis,m.reporting_currency,
    m.period_status,m.period_cutoff_date,m.opening_included_cash,m.closing_included_cash,
    m.closing_unavailable_cash,m.cash_collected_from_customers,m.operating_cash_paid,
    m.owner_draws_paid,m.debt_principal_paid,m.debt_interest_paid,m.investing_cash_paid,
    m.investing_cash_received,m.debt_funding_received,m.owner_funding_received,
    m.other_cash_inflows,m.other_cash_outflows,m.closing_taxes_reserved,
    m.ar_expected_within_30_days,m.ap_due_within_30_days,m.available_credit,
    m.credit_currently_drawn,m.lowest_observed_cash
  FROM jsonb_to_recordset(p_months) AS m(
    month_date date,notes text,data_contract_version smallint,source_type text,
    accounting_basis text,reporting_currency text,period_status text,period_cutoff_date date,
    opening_included_cash numeric,closing_included_cash numeric,closing_unavailable_cash numeric,
    cash_collected_from_customers numeric,operating_cash_paid numeric,owner_draws_paid numeric,
    debt_principal_paid numeric,debt_interest_paid numeric,investing_cash_paid numeric,
    investing_cash_received numeric,debt_funding_received numeric,owner_funding_received numeric,
    other_cash_inflows numeric,other_cash_outflows numeric,closing_taxes_reserved numeric,
    ar_expected_within_30_days numeric,ap_due_within_30_days numeric,available_credit numeric,
    credit_currently_drawn numeric,lowest_observed_cash numeric
  )
  ON CONFLICT (user_id,month_date) DO UPDATE SET
    business_id = EXCLUDED.business_id,opening_cash = EXCLUDED.opening_cash,
    closing_cash = EXCLUDED.closing_cash,total_revenue = EXCLUDED.total_revenue,
    total_expenses = EXCLUDED.total_expenses,payroll = NULL,ar_outstanding = NULL,
    ap_outstanding = NULL,notes = EXCLUDED.notes,data_contract_version = 2,
    source_type = 'spreadsheet',accounting_basis = EXCLUDED.accounting_basis,
    reporting_currency = EXCLUDED.reporting_currency,period_status = EXCLUDED.period_status,
    period_cutoff_date = EXCLUDED.period_cutoff_date,
    opening_included_cash = EXCLUDED.opening_included_cash,
    closing_included_cash = EXCLUDED.closing_included_cash,
    closing_unavailable_cash = EXCLUDED.closing_unavailable_cash,
    cash_collected_from_customers = EXCLUDED.cash_collected_from_customers,
    operating_cash_paid = EXCLUDED.operating_cash_paid,owner_draws_paid = EXCLUDED.owner_draws_paid,
    debt_principal_paid = EXCLUDED.debt_principal_paid,debt_interest_paid = EXCLUDED.debt_interest_paid,
    investing_cash_paid = EXCLUDED.investing_cash_paid,
    investing_cash_received = EXCLUDED.investing_cash_received,
    debt_funding_received = EXCLUDED.debt_funding_received,
    owner_funding_received = EXCLUDED.owner_funding_received,
    other_cash_inflows = EXCLUDED.other_cash_inflows,
    other_cash_outflows = EXCLUDED.other_cash_outflows,
    closing_taxes_reserved = EXCLUDED.closing_taxes_reserved,
    ar_expected_within_30_days = EXCLUDED.ar_expected_within_30_days,
    ap_due_within_30_days = EXCLUDED.ap_due_within_30_days,
    available_credit = EXCLUDED.available_credit,
    credit_currently_drawn = EXCLUDED.credit_currently_drawn,
    lowest_observed_cash = EXCLUDED.lowest_observed_cash,
    updated_at = clock_timestamp();

  v_version := clock_timestamp();
  UPDATE public.business_profiles SET data_version = v_version WHERE user_id = p_user_id;
  INSERT INTO public.data_imports (user_id,import_type,filename,months_imported,status,error_message)
    VALUES (p_user_id,'excel',p_filename,v_count,'success',NULL);
  SELECT count(*),min(month_date::text),max(month_date::text) INTO v_total,v_from,v_to
    FROM public.financial_months WHERE user_id = p_user_id;
  SELECT COALESCE(closing_included_cash,closing_cash) INTO v_cash
    FROM public.financial_months WHERE user_id = p_user_id AND month_date::text = v_to;
  RETURN jsonb_build_object('replaced',v_replaced,'months_imported',v_count,
    'mode',p_mode,'months_total',v_total,'date_from',v_from,'date_to',v_to,'current_cash',v_cash);
END;
$$;

REVOKE ALL ON FUNCTION public.import_financial_data_v2(uuid,jsonb,jsonb,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_financial_data_v2(uuid,jsonb,jsonb,text,text) TO service_role;
COMMENT ON FUNCTION public.import_financial_data_v2(uuid,jsonb,jsonb,text,text) IS
  'Server-only version-2 spreadsheet import. Validates classified cash rows, reconciles within one currency unit, archives displaced data, preserves settings and writes atomically.';

CREATE OR REPLACE FUNCTION public.import_reviewed_financial_data(
  p_user_id uuid,p_months jsonb,p_profile jsonb,p_filename text,
  p_mode text,p_expected_state text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_business_id uuid;
  v_actual_state text;
  v_has_v2 boolean;
  v_has_legacy boolean;
BEGIN
  IF p_user_id IS NULL OR p_expected_state IS NULL OR p_expected_state !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Account and reviewed state are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_months) IS DISTINCT FROM 'array' OR jsonb_array_length(p_months) = 0 THEN
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
    RETURN public.import_financial_data_v2(p_user_id,p_months,p_profile,p_filename,p_mode);
  END IF;
  RETURN public.import_financial_data(p_user_id,p_months,p_profile,p_filename,p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) TO service_role;
COMMENT ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) IS
  'Server-only reviewed import. Locks and verifies account state, rejects mixed contracts, and dispatches atomically to the strict v2 or legacy engine.';

COMMIT;
