-- Apply in PREVIEW first, after 2026-10-23-atomic-financial-import.sql.
-- This installs a function only; it does not clear any account data.
BEGIN;

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
  IS 'Server-only atomic financial clear. Uses the import profile-row lock. API supplies validated Auth user ID.';

COMMIT;
