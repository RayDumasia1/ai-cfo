-- PREVIEW first, after preserve-import-settings and atomic-financial-clear.
-- Installing this migration creates storage/functions only. No historical data is backfilled.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.replace_financial_import(uuid,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.clear_financial_data(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the atomic import, preserve-import-settings, and atomic clear migrations first';
  END IF;
END;
$$;

CREATE TABLE public.financial_data_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  format_version smallint NOT NULL DEFAULT 1 CHECK (format_version = 1),
  -- data_version is an opaque text token, even when it looks like a timestamp.
  source_data_version text,
  replaced_by_filename text NOT NULL CHECK (btrim(replaced_by_filename) <> ''),
  profile_snapshot jsonb NOT NULL CHECK (jsonb_typeof(profile_snapshot) = 'object'),
  months_snapshot jsonb NOT NULL CHECK (jsonb_typeof(months_snapshot) = 'array'),
  categories_snapshot jsonb NOT NULL CHECK (jsonb_typeof(categories_snapshot) = 'array')
);
CREATE INDEX financial_data_revisions_account_order
  ON public.financial_data_revisions (user_id, id DESC);
ALTER TABLE public.financial_data_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_data_revisions FORCE ROW LEVEL SECURITY;
-- No browser policies or write grants. Revisions are server-only until a
-- separately authorized history/restore flow is implemented.
REVOKE ALL ON TABLE public.financial_data_revisions FROM PUBLIC, anon, authenticated;
-- Supabase may grant privileges through default privileges on new tables.
-- Reset the server grant too so history cannot be silently edited in place.
REVOKE ALL ON TABLE public.financial_data_revisions FROM service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.financial_data_revisions TO service_role;
REVOKE ALL ON SEQUENCE public.financial_data_revisions_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.financial_data_revisions_id_seq FROM service_role;
GRANT USAGE, SELECT ON SEQUENCE public.financial_data_revisions_id_seq TO service_role;
COMMENT ON TABLE public.financial_data_revisions IS
  'Last 20 displaced datasets per account. Server-only. Clear Data purges revisions; account deletion cascades. No restore UI or historical backfill.';

CREATE OR REPLACE FUNCTION public.replace_financial_import(
  p_user_id uuid,
  p_months jsonb,
  p_profile jsonb,
  p_filename text
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
BEGIN
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
      user_id, source_data_version, replaced_by_filename,
      profile_snapshot, months_snapshot, categories_snapshot
    )
    SELECT p_user_id, bp.data_version, p_filename,
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
  DELETE FROM public.expense_categories WHERE user_id = p_user_id;
  DELETE FROM public.financial_months WHERE user_id = p_user_id;
  INSERT INTO public.financial_months (
    user_id, business_id, month_date, opening_cash, closing_cash, total_revenue,
    total_expenses, payroll, ar_outstanding, ap_outstanding, notes
  ) SELECT p_user_id, v_business_id, m.month_date, m.opening_cash, m.closing_cash,
      m.total_revenue, m.total_expenses, m.payroll, m.ar_outstanding, m.ap_outstanding, m.notes
    FROM jsonb_to_recordset(p_months) AS m(
      month_date date, opening_cash numeric, closing_cash numeric,
      total_revenue numeric, total_expenses numeric, payroll numeric,
      ar_outstanding numeric, ap_outstanding numeric, notes text
    );

  -- Generate the version after acquiring the lock, including queued imports.
  v_version := clock_timestamp();
  UPDATE public.business_profiles SET data_version = v_version WHERE user_id = p_user_id;
  INSERT INTO public.data_imports (user_id, import_type, filename, months_imported, status, error_message)
    VALUES (p_user_id, 'excel', p_filename, v_count, 'success', NULL);
  RETURN jsonb_build_object('replaced', v_replaced, 'months_imported', v_count);
END;
$$;

-- Only the verified server route may supply p_user_id. A browser JWT must
-- never be able to invoke this cross-account service operation directly.
REVOKE ALL ON FUNCTION public.replace_financial_import(uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_financial_import(uuid, jsonb, jsonb, text) TO service_role;
COMMENT ON FUNCTION public.replace_financial_import(uuid, jsonb, jsonb, text)
  IS 'Server-only atomic financial replacement. The API supplies the validated Auth user ID. Preserves account settings; archives the last 20 displaced datasets atomically. No billing writes.';


CREATE OR REPLACE FUNCTION public.clear_financial_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Account is required' USING ERRCODE = '22023';
  END IF;

  -- Use exactly the same account lock as replace_financial_import. Even an
  -- account without a profile needs a stable lock row for concurrent requests.
  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;

  -- Clear Data is permanent: never archive this operation, purge history too.
  DELETE FROM public.financial_data_revisions WHERE user_id = p_user_id;
  DELETE FROM public.expense_categories WHERE user_id = p_user_id;
  DELETE FROM public.financial_months WHERE user_id = p_user_id;
  UPDATE public.business_profiles SET
    min_cash_reserve = NULL,
    runway_warning_threshold = 6,
    runway_danger_threshold = 3,
    burn_rate_warning_pct = 0.1,
    invoice_overdue_days = 30,
    data_version = clock_timestamp()
  WHERE user_id = p_user_id;

  -- Commit the clear, settings reset, data version, and audit together.
  -- No subscription, member identity, onboarding, or action writes.
  INSERT INTO public.data_imports (user_id, import_type, filename, months_imported, status, error_message)
    VALUES (p_user_id, 'manual', NULL, 0, 'success', 'User cleared data');
  RETURN jsonb_build_object('cleared', true);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_financial_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data(uuid) TO service_role;
COMMENT ON FUNCTION public.clear_financial_data(uuid)
  IS 'Server-only atomic financial clear. Purges retained revisions atomically. Uses the import profile-row lock. API supplies validated Auth user ID.';


COMMIT;
