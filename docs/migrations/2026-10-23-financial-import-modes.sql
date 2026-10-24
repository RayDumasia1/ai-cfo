-- PREVIEW first, AFTER financial-revision-history (including its text-version fix if needed).
-- Installs a new mode-aware engine; legacy replacement callers retain their behavior.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.financial_data_revisions') IS NULL THEN
    RAISE EXCEPTION 'Apply the financial revision-history migration first';
  END IF;
  IF (SELECT atttypid FROM pg_attribute WHERE attrelid = 'public.financial_data_revisions'::regclass
      AND attname = 'source_data_version' AND NOT attisdropped) IS DISTINCT FROM 'text'::regtype::oid THEN
    RAISE EXCEPTION 'Apply the financial revision text-version repair first';
  END IF;
END;
$$;
ALTER TABLE public.financial_data_revisions ADD COLUMN operation_mode text NOT NULL
  DEFAULT 'replace_all' CHECK (operation_mode IN ('update_months','replace_all'));

CREATE OR REPLACE FUNCTION public.import_financial_data(
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

  -- Never accept identity/ownership fields from parsed workbook content.
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_profile) AS k(key)
    WHERE key NOT IN ('business_name', 'industry', 'accounting_system', 'employee_count',
      'min_cash_reserve', 'runway_warning_threshold', 'runway_danger_threshold',
      'burn_rate_warning_pct', 'invoice_overdue_days')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_months) AS m(value),
      LATERAL jsonb_object_keys(m.value) AS k(key)
    WHERE key NOT IN ('month_date', 'opening_cash', 'closing_cash', 'total_revenue',
      'total_expenses', 'payroll', 'ar_outstanding', 'ap_outstanding', 'notes')
  ) THEN
    RAISE EXCEPTION 'Unexpected import fields' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_months) AS m(month_date date)
    WHERE month_date IS NULL OR extract(day FROM month_date) <> 1
  ) OR (SELECT count(DISTINCT month_date)
        FROM jsonb_to_recordset(p_months) AS m(month_date date)) <> v_count THEN
    RAISE EXCEPTION 'Import months must be distinct first-of-month dates' USING ERRCODE = '22023';
  END IF;

  -- Lock one stable account row before inspecting/replacing data. Two imports
  -- for the same account serialize; imports for different accounts can proceed.
  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.financial_months WHERE user_id = p_user_id)
    INTO v_replaced;
  -- Capture the PREVIOUS dataset before any profile/financial replacement.
  -- The profile lock serializes snapshots with imports/clears for this account.
  -- Empty imports do not create empty history; category-only data is retained.
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
      COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month_date, m.id)
        FROM public.financial_months m WHERE m.user_id = p_user_id), '[]'::jsonb),
      COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.month_date, c.id)
        FROM public.expense_categories c WHERE c.user_id = p_user_id), '[]'::jsonb)
    FROM public.business_profiles bp WHERE bp.user_id = p_user_id;

    -- Bound storage by revision count. Identity ordering avoids timestamp ties.
    -- A pruning failure must roll back both the new revision and replacement.
    DELETE FROM public.financial_data_revisions
    WHERE user_id = p_user_id AND id IN (
      SELECT id FROM public.financial_data_revisions WHERE user_id = p_user_id
      ORDER BY id DESC OFFSET 20
    );
  END IF;

  -- Accept legacy workbook setting keys for deployment compatibility, but ignore them.
  -- Strip before record conversion so ignored values cannot cause casts or writes.
  v_profile := jsonb_populate_record(NULL::public.business_profiles,
    p_profile - ARRAY['min_cash_reserve','runway_warning_threshold','runway_danger_threshold',
      'burn_rate_warning_pct','invoice_overdue_days']);

  -- Onboarding/settings own existing account details. Workbook business fields
  -- may only initialize null fields before onboarding completes. Null afterward
  -- (including an explicitly cleared business name) must remain null.
  -- The same profile-row lock serializes this decision with settings/onboarding.
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

  -- Delete dependants first; every operation remains inside this transaction.
  DELETE FROM public.expense_categories WHERE user_id = p_user_id
    AND (p_mode = 'replace_all' OR month_date::text IN (
      SELECT m.month_date::text FROM jsonb_to_recordset(p_months) AS m(month_date date)
    ));
  IF p_mode = 'replace_all' THEN
    DELETE FROM public.financial_months WHERE user_id = p_user_id;
  END IF;
  INSERT INTO public.financial_months (
    user_id, business_id, month_date, opening_cash, closing_cash, total_revenue,
    total_expenses, payroll, ar_outstanding, ap_outstanding, notes
  ) SELECT p_user_id, v_business_id, m.month_date, m.opening_cash, m.closing_cash,
      m.total_revenue, m.total_expenses, m.payroll, m.ar_outstanding, m.ap_outstanding, m.notes
    FROM jsonb_to_recordset(p_months) AS m(
      month_date date, opening_cash numeric, closing_cash numeric,
      total_revenue numeric, total_expenses numeric, payroll numeric,
      ar_outstanding numeric, ap_outstanding numeric, notes text
    )
    WHERE true
    ON CONFLICT (user_id, month_date) DO UPDATE SET
      business_id = EXCLUDED.business_id, opening_cash = EXCLUDED.opening_cash,
      closing_cash = EXCLUDED.closing_cash, total_revenue = EXCLUDED.total_revenue,
      total_expenses = EXCLUDED.total_expenses, payroll = EXCLUDED.payroll,
      ar_outstanding = EXCLUDED.ar_outstanding, ap_outstanding = EXCLUDED.ap_outstanding,
      notes = EXCLUDED.notes, updated_at = clock_timestamp();

  -- Generate the version after acquiring the lock, including queued imports.
  v_version := clock_timestamp();
  UPDATE public.business_profiles SET data_version = v_version WHERE user_id = p_user_id;
  INSERT INTO public.data_imports (user_id, import_type, filename, months_imported, status, error_message)
    VALUES (p_user_id, 'excel', p_filename, v_count, 'success', NULL);
  SELECT count(*), min(month_date::text), max(month_date::text) INTO v_total, v_from, v_to
    FROM public.financial_months WHERE user_id = p_user_id;
  SELECT closing_cash INTO v_cash FROM public.financial_months
    WHERE user_id = p_user_id AND month_date::text = v_to;
  RETURN jsonb_build_object('replaced', v_replaced, 'months_imported', v_count,
    'mode', p_mode, 'months_total', v_total, 'date_from', v_from, 'date_to', v_to, 'current_cash', v_cash);
END;
$$;

-- Only the verified server route may supply p_user_id. A browser JWT must
-- never be able to invoke this cross-account service operation directly.
REVOKE ALL ON FUNCTION public.import_financial_data(uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_financial_data(uuid, jsonb, jsonb, text, text) TO service_role;
COMMENT ON FUNCTION public.import_financial_data(uuid, jsonb, jsonb, text, text)
  IS 'Server-only update-months or full replacement with atomic revision capture, preserved settings, and resulting dataset summary. No billing writes.';



-- Keep the existing signature/response for old app instances and SQL verifiers.
CREATE OR REPLACE FUNCTION public.replace_financial_import(
  p_user_id uuid, p_months jsonb, p_profile jsonb, p_filename text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.import_financial_data(p_user_id, p_months, p_profile, p_filename, 'replace_all')
    - ARRAY['mode','months_total','date_from','date_to','current_cash'];
$$;
REVOKE ALL ON FUNCTION public.replace_financial_import(uuid,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_financial_import(uuid,jsonb,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.replace_financial_import(uuid,jsonb,jsonb,text) IS
  'Legacy server-only full replacement. Delegates to the mode-aware history-preserving import engine.';
COMMIT;
