-- PREVIEW ONLY. Rolls back all changes.
-- Supply a dedicated preview account that currently has a weekly-plan draft.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  v_account uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_version uuid;
  v_updated_at timestamptz;
  v_result jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT preview_confirmed
     OR v_account = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply a dedicated account UUID; run as postgres';
  END IF;

  SELECT id, updated_at INTO v_version, v_updated_at
  FROM public.cash_forecast_versions
  WHERE user_id = v_account AND status = 'draft'
  ORDER BY version_number DESC LIMIT 1;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'The dedicated preview account needs a weekly-plan draft';
  END IF;

  ASSERT has_function_privilege('service_role',
    'public.discard_cash_forecast_draft(uuid,uuid,timestamptz)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated',
    'public.discard_cash_forecast_draft(uuid,uuid,timestamptz)', 'EXECUTE');

  EXECUTE 'SET LOCAL ROLE service_role';
  v_result := public.discard_cash_forecast_draft(gen_random_uuid(), v_version, v_updated_at);
  ASSERT v_result->>'reason' = 'changed' AND EXISTS (
    SELECT 1 FROM public.cash_forecast_versions WHERE id = v_version
  ), 'Another account could affect the draft';

  v_result := public.discard_cash_forecast_draft(v_account, v_version, v_updated_at - interval '1 second');
  ASSERT v_result->>'reason' = 'changed' AND EXISTS (
    SELECT 1 FROM public.cash_forecast_versions WHERE id = v_version
  ), 'A stale request affected the draft';

  v_result := public.discard_cash_forecast_draft(v_account, v_version, v_updated_at);
  ASSERT (v_result->>'discarded')::boolean, 'The valid discard was rejected';
  ASSERT NOT EXISTS (SELECT 1 FROM public.cash_forecast_versions WHERE id = v_version),
    'The draft version remains';
  ASSERT NOT EXISTS (SELECT 1 FROM public.cash_forecast_items WHERE version_id = v_version),
    'Draft cash items remain';
  EXECUTE 'RESET ROLE';

  RAISE NOTICE 'PASS: draft discard is atomic, account-scoped, and stale-write protected.';
END $$;
ROLLBACK;
