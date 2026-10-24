-- Apply in PREVIEW first, after financial-revision-history.
-- Installs functions only; does not clear or restore any account data/settings.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.financial_data_revisions') IS NULL
     OR to_regprocedure('public.clear_financial_data(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply financial revision history before preserving settings on clear';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_financial_data_preserving_settings(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Account is required' USING ERRCODE = '22023';
  END IF;

  -- Same stable account lock as imports, settings updates, and legacy clears.
  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;

  DELETE FROM public.financial_data_revisions WHERE user_id = p_user_id;
  DELETE FROM public.expense_categories WHERE user_id = p_user_id;
  DELETE FROM public.financial_months WHERE user_id = p_user_id;
  -- Account preferences are independent of the financial dataset. Preserve
  -- all five thresholds exactly, including null, zero, and fractional values.
  UPDATE public.business_profiles SET data_version = clock_timestamp()
    WHERE user_id = p_user_id;
  INSERT INTO public.data_imports (user_id, import_type, filename, months_imported, status, error_message)
    VALUES (p_user_id, 'manual', NULL, 0, 'success', 'User cleared data');
  RETURN jsonb_build_object('cleared', true);
END;
$$;
REVOKE ALL ON FUNCTION public.clear_financial_data_preserving_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data_preserving_settings(uuid) TO service_role;
COMMENT ON FUNCTION public.clear_financial_data_preserving_settings(uuid) IS
  'Server-only atomic financial/history purge. Preserves all account settings; advances data_version and records the clear audit.';

-- Existing deployments also adopt the corrected behavior once SQL commits.
-- New code calls the explicit function above so a missing migration fails
-- without falling back to an old function that resets account thresholds.
CREATE OR REPLACE FUNCTION public.clear_financial_data(p_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.clear_financial_data_preserving_settings(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.clear_financial_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data(uuid) TO service_role;
COMMENT ON FUNCTION public.clear_financial_data(uuid) IS
  'Legacy server-only clear wrapper; preserves settings through clear_financial_data_preserving_settings.';
COMMIT;
