-- Apply in PREVIEW first. FORECAST-01D traceable forecast-to-action handoff.
BEGIN;
ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS linked_forecast_version_id uuid REFERENCES public.cash_forecast_versions(id),
  ADD COLUMN IF NOT EXISTS linked_forecast_item_id uuid REFERENCES public.cash_forecast_items(id);
ALTER TABLE public.actions ADD CONSTRAINT actions_forecast_item_requires_version
  CHECK (linked_forecast_item_id IS NULL OR linked_forecast_version_id IS NOT NULL);
ALTER TABLE public.actions ADD CONSTRAINT actions_forecast_version_owner_fk
  FOREIGN KEY(linked_forecast_version_id,user_id) REFERENCES public.cash_forecast_versions(id,user_id);
ALTER TABLE public.actions ADD CONSTRAINT actions_forecast_item_owner_fk
  FOREIGN KEY(linked_forecast_item_id,linked_forecast_version_id,user_id)
  REFERENCES public.cash_forecast_items(id,version_id,user_id);
CREATE INDEX IF NOT EXISTS actions_linked_forecast_version_idx
  ON public.actions(linked_forecast_version_id) WHERE linked_forecast_version_id IS NOT NULL;
CREATE UNIQUE INDEX cash_forecast_versions_one_draft_case
  ON public.cash_forecast_versions(forecast_id,case_type) WHERE status='draft';

CREATE OR REPLACE FUNCTION public.begin_core_forecast_revision(p_user_id uuid,p_published_version_id uuid,
  p_as_of_date date,p_start_date date,p_starting_included_cash numeric,p_minimum_reserve numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_old public.cash_forecast_versions%ROWTYPE; v_result jsonb; v_new_version uuid; v_updated_at timestamptz;
BEGIN
  SELECT * INTO v_old FROM public.cash_forecast_versions
    WHERE id=p_published_version_id AND user_id=p_user_id AND case_type='base' AND status='published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Published base forecast not found' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.cash_forecast_schedules WHERE version_id=v_old.id)
     OR EXISTS(SELECT 1 FROM public.cash_forecast_assumptions WHERE version_id=v_old.id) THEN
    RAISE EXCEPTION 'Core revision cannot copy advanced forecast records' USING ERRCODE='0A000';
  END IF;
  v_result:=public.begin_cash_forecast_draft(p_user_id,
    (SELECT business_id FROM public.cash_forecasts WHERE id=v_old.forecast_id),
    (SELECT reporting_currency FROM public.cash_forecasts WHERE id=v_old.forecast_id),
    p_as_of_date,p_start_date,p_starting_included_cash,v_old.starting_unavailable_cash,
    p_minimum_reserve,v_old.source_data_version,v_old.formula_policy_version,v_old.source_snapshot,v_old.id);
  v_new_version:=(v_result->>'version_id')::uuid;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,counterparty,amount,direction,category,
    expected_date,status,confidence,amount_is_estimated,date_is_estimated,zero_confirmed,source_type,source_reference,
    source_updated_at,evidence,created_by,updated_by)
  SELECT v_new_version,p_user_id,item_key,description,counterparty,amount,direction,category,expected_date,
    CASE WHEN status IN('paid','received','cancelled') THEN 'excluded' ELSE status END,confidence,amount_is_estimated,
    date_is_estimated,zero_confirmed,source_type,source_reference,source_updated_at,evidence,p_user_id,p_user_id
  FROM public.cash_forecast_items WHERE version_id=v_old.id;
  SELECT updated_at INTO STRICT v_updated_at FROM public.cash_forecast_versions WHERE id=v_new_version;
  RETURN v_result || jsonb_build_object('updated_at',v_updated_at);
END $$;
REVOKE ALL ON FUNCTION public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric) TO service_role;
COMMIT;
