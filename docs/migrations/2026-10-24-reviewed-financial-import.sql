-- PREVIEW first, after financial-import-modes and preserve-settings-on-financial-clear.
-- Installs functions only. Preparing a review does not create profiles, audits, or financial rows.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.import_financial_data(uuid,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the financial import-modes migration first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_import_review_state(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
SET timezone = 'UTC' SET datestyle = 'ISO, YMD' AS $$
  SELECT jsonb_build_object(
    'state_version', md5(jsonb_build_object(
      'data_version', (SELECT data_version FROM public.business_profiles WHERE user_id = p_user_id),
      'months', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month_date,m.id)
        FROM public.financial_months m WHERE m.user_id = p_user_id),'[]'::jsonb),
      'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.month_date,c.id)
        FROM public.expense_categories c WHERE c.user_id = p_user_id),'[]'::jsonb)
    )::text),
    'months', COALESCE((SELECT jsonb_agg(month_date::text ORDER BY month_date)
      FROM public.financial_months WHERE user_id = p_user_id),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.financial_import_review_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_import_review_state(uuid) TO service_role;
COMMENT ON FUNCTION public.financial_import_review_state(uuid) IS
  'Server-only read-only coherent review state. Fingerprints current financial rows/categories and opaque data_version; returns month keys, no draft storage.';

CREATE OR REPLACE FUNCTION public.import_reviewed_financial_data(
  p_user_id uuid, p_months jsonb, p_profile jsonb, p_filename text,
  p_mode text, p_expected_state text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_business_id uuid;
  v_actual_state text;
BEGIN
  IF p_user_id IS NULL OR p_expected_state IS NULL OR p_expected_state !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Account and reviewed state are required' USING ERRCODE = '22023';
  END IF;
  -- Same lock and ordering as mode imports and Clear Data. A second confirmation
  -- waits, then checks the state produced by the first committed transaction.
  INSERT INTO public.business_profiles (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO STRICT v_business_id FROM public.business_profiles
    WHERE user_id = p_user_id FOR UPDATE;
  SELECT public.financial_import_review_state(p_user_id)->>'state_version' INTO v_actual_state;
  IF v_actual_state IS DISTINCT FROM p_expected_state THEN
    RAISE EXCEPTION 'import_review_stale' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.import_financial_data(p_user_id,p_months,p_profile,p_filename,p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) TO service_role;
COMMENT ON FUNCTION public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text) IS
  'Server-only reviewed import. API validates signed file/account/mode token; SQL checks current state under profile lock and delegates atomically to the mode engine.';
COMMIT;
