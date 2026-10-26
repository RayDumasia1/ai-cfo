-- Apply in PREVIEW first. Atomically discards one account-owned forecast draft.
BEGIN;

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.discard_cash_forecast_draft(
  p_user_id uuid,
  p_version_id uuid,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version public.cash_forecast_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_version
  FROM public.cash_forecast_versions
  WHERE id = p_version_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_version.status <> 'draft'
     OR v_version.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('discarded', false, 'reason', 'changed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.actions
    WHERE user_id = p_user_id AND linked_forecast_version_id = p_version_id
  ) THEN
    RETURN jsonb_build_object('discarded', false, 'reason', 'linked_action');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cash_forecast_versions
    WHERE parent_version_id = p_version_id
  ) THEN
    RETURN jsonb_build_object('discarded', false, 'reason', 'linked_version');
  END IF;

  -- Delete children while the draft parent is still visible. Their protection
  -- triggers reject a parent-driven cascade after the parent row disappears.
  DELETE FROM public.cash_forecast_assumption_items
    WHERE version_id = p_version_id AND user_id = p_user_id;
  DELETE FROM public.cash_forecast_assumptions
    WHERE version_id = p_version_id AND user_id = p_user_id;
  DELETE FROM public.cash_forecast_items
    WHERE version_id = p_version_id AND user_id = p_user_id;
  DELETE FROM public.cash_forecast_schedules
    WHERE version_id = p_version_id AND user_id = p_user_id;
  DELETE FROM public.cash_forecast_versions
    WHERE id = p_version_id AND user_id = p_user_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft changed while it was being discarded' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object('discarded', true, 'reason', null);
END $$;

REVOKE ALL ON FUNCTION public.discard_cash_forecast_draft(uuid,uuid,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_cash_forecast_draft(uuid,uuid,timestamptz)
  TO service_role;

COMMIT;
