-- FORECAST-01E5. Apply in PREVIEW first. Existing base plans are unchanged.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF; END $$;
ALTER TABLE public.cash_forecast_versions
  ADD COLUMN case_name text CHECK (case_name IS NULL OR length(btrim(case_name)) BETWEEN 1 AND 120),
  ADD COLUMN case_request_key uuid,
  ADD COLUMN case_request_payload jsonb CHECK (case_request_payload IS NULL OR
    (jsonb_typeof(case_request_payload)='object' AND pg_column_size(case_request_payload)<=1048576)),
  ADD CONSTRAINT cash_forecast_case_request_pair CHECK ((case_request_key IS NULL)=(case_request_payload IS NULL));
CREATE UNIQUE INDEX cash_forecast_case_request_once ON public.cash_forecast_versions(user_id,case_request_key) WHERE case_request_key IS NOT NULL;

CREATE FUNCTION public.save_cash_forecast_case(p_user_id uuid,p_base_version_id uuid,p_case_type text,p_name text,
  p_request_key uuid,p_assumptions jsonb,p_case_result jsonb,p_base_result jsonb,p_evaluation_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_base public.cash_forecast_versions%ROWTYPE; v_existing public.cash_forecast_versions%ROWTYPE;
  v_business uuid; v_forecast uuid; v_version uuid; v_number integer; v_request jsonb; v_assumption jsonb;
  v_assumption_id uuid; v_now timestamptz:=clock_timestamp(); v_updated timestamptz;
BEGIN
  SELECT f.business_id,f.id INTO v_business,v_forecast FROM public.cash_forecast_versions v
    JOIN public.cash_forecasts f ON f.id=v.forecast_id AND f.user_id=v.user_id
    WHERE v.id=p_base_version_id AND v.user_id=p_user_id AND v.case_type='base';
  PERFORM 1 FROM public.business_profiles WHERE id=v_business AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Base plan not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.cash_forecasts WHERE id=v_forecast AND user_id=p_user_id FOR UPDATE;
  SELECT * INTO STRICT v_base FROM public.cash_forecast_versions WHERE id=p_base_version_id AND user_id=p_user_id FOR UPDATE;
  v_request:=jsonb_build_object('baseVersionId',p_base_version_id,'caseType',p_case_type,'name',p_name,'assumptions',p_assumptions,
    'caseResult',p_case_result,'baseResult',p_base_result,'evaluationDate',p_evaluation_date);
  SELECT * INTO v_existing FROM public.cash_forecast_versions WHERE user_id=p_user_id AND case_request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.case_request_payload IS DISTINCT FROM v_request THEN RAISE EXCEPTION 'Request key reused with different case' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('version_id',v_existing.id,'version_number',v_existing.version_number,'replayed',true);
  END IF;
  IF v_base.status<>'published' THEN RAISE EXCEPTION 'Base plan changed; choose the current published base' USING ERRCODE='40001'; END IF;
  IF p_request_key IS NULL OR p_case_type IS NULL OR p_case_type NOT IN ('downside','upside')
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_evaluation_date IS NULL OR p_evaluation_date>current_date OR p_evaluation_date<v_base.as_of_date
    OR p_assumptions IS NULL OR jsonb_typeof(p_assumptions)<>'array' OR jsonb_array_length(p_assumptions) NOT BETWEEN 1 AND 50
    OR pg_column_size(p_assumptions)>131072
    OR p_case_result IS NULL OR p_case_result->>'valid' IS DISTINCT FROM 'true'
    OR p_base_result IS NULL OR p_base_result->>'valid' IS DISTINCT FROM 'true'
    OR jsonb_array_length(p_case_result->'weeks') IS DISTINCT FROM 13 OR jsonb_array_length(p_base_result->'weeks') IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION 'Invalid case inputs or calculations' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assumptions) a GROUP BY a->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_assumptions) a CROSS JOIN LATERAL jsonb_array_elements_text(a->'itemIds') item
      GROUP BY item,a->>'operation' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate or conflicting assumptions' USING ERRCODE='23514'; END IF;
  FOR v_assumption IN SELECT value FROM jsonb_array_elements(p_assumptions) LOOP
    IF length(coalesce(v_assumption->>'name','')) NOT BETWEEN 1 AND 120
      OR length(btrim(coalesce(v_assumption->>'rationale',''))) NOT BETWEEN 1 AND 2000
      OR coalesce(v_assumption->>'operation','') NOT IN ('amount_multiplier','date_shift_days','exclude')
      OR jsonb_array_length(v_assumption->'itemIds') IS NULL OR jsonb_array_length(v_assumption->'itemIds') NOT BETWEEN 1 AND 2000
      OR (v_assumption->>'operation'='exclude' AND v_assumption->'value' IS DISTINCT FROM 'null'::jsonb)
      OR (v_assumption->>'operation'<>'exclude' AND (v_assumption->>'value' IS NULL OR (v_assumption->>'value')::numeric NOT BETWEEN -365 AND 365))
      OR (v_assumption->>'operation'='amount_multiplier' AND ((v_assumption->>'value')::numeric NOT BETWEEN 0 AND 10 OR (v_assumption->>'value')::numeric<>round((v_assumption->>'value')::numeric,6)))
      OR (v_assumption->>'operation'='date_shift_days' AND (v_assumption->>'value')::numeric<>trunc((v_assumption->>'value')::numeric)) THEN
      RAISE EXCEPTION 'Invalid assumption' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_assumption->'itemIds') ref WHERE NOT EXISTS(
      SELECT 1 FROM public.cash_forecast_items i WHERE i.id=ref::uuid AND i.version_id=p_base_version_id AND i.user_id=p_user_id AND i.status IN ('expected','confirmed'))) THEN
      RAISE EXCEPTION 'Assumption item must belong to the active source base' USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT coalesce(max(version_number),0)+1 INTO v_number FROM public.cash_forecast_versions WHERE forecast_id=v_forecast;
  INSERT INTO public.cash_forecast_versions(forecast_id,user_id,version_number,case_type,status,parent_version_id,as_of_date,start_date,
    starting_included_cash,starting_unavailable_cash,minimum_reserve,source_data_version,formula_policy_version,source_snapshot,
    case_name,case_request_key,case_request_payload,created_by)
  VALUES(v_forecast,p_user_id,v_number,p_case_type,'draft',v_base.id,v_base.as_of_date,v_base.start_date,
    v_base.starting_included_cash,v_base.starting_unavailable_cash,v_base.minimum_reserve,v_base.source_data_version,v_base.formula_policy_version,
    v_base.source_snapshot||jsonb_build_object('case_base_version_id',v_base.id,'case_item_references','source-base-ids-1'),p_name,p_request_key,v_request,p_user_id)
  RETURNING id INTO v_version;
  -- Keep unmodified source inputs and explicit lineage; assumptions are applied by
  -- the pure engine, never by overwriting the base or these retained source rows.
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,counterparty,amount,direction,category,expected_date,
    status,confidence,amount_is_estimated,date_is_estimated,zero_confirmed,source_type,source_reference,source_updated_at,evidence,created_by,updated_by)
  SELECT v_version,p_user_id,item_key,description,counterparty,amount,direction,category,expected_date,status,confidence,
    amount_is_estimated,date_is_estimated,zero_confirmed,source_type,source_reference,source_updated_at,
    evidence||jsonb_build_object('case_base_item_id',id,'case_base_schedule_id',schedule_id),p_user_id,p_user_id
    FROM public.cash_forecast_items WHERE version_id=v_base.id AND user_id=p_user_id;
  FOR v_assumption IN SELECT value FROM jsonb_array_elements(p_assumptions) LOOP
    INSERT INTO public.cash_forecast_assumptions(version_id,user_id,name,operation,numeric_value,rationale,created_by)
    VALUES(v_version,p_user_id,v_assumption->>'name',v_assumption->>'operation',(v_assumption->>'value')::numeric,v_assumption->>'rationale',p_user_id)
    RETURNING id INTO v_assumption_id;
    INSERT INTO public.cash_forecast_assumption_items(assumption_id,item_id,version_id,user_id)
    SELECT v_assumption_id,i.id,v_version,p_user_id FROM public.cash_forecast_items i
      WHERE i.version_id=v_version AND i.user_id=p_user_id AND i.evidence->>'case_base_item_id' IN
        (SELECT jsonb_array_elements_text(v_assumption->'itemIds'));
  END LOOP;
  SELECT updated_at INTO v_updated FROM public.cash_forecast_versions WHERE id=v_version;
  PERFORM public.publish_cash_forecast_version(p_user_id,v_forecast,v_version,p_case_result,v_updated);
  RETURN jsonb_build_object('version_id',v_version,'version_number',v_number,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_cash_forecast_case(uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_cash_forecast_case(uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,date) TO service_role;

-- Core revision creation previously locked the base version before its business.
-- Use the same business -> forecast -> version order as case/review saves, so a
-- simultaneous Core update cannot invert these locks against a case save.
CREATE OR REPLACE FUNCTION public.begin_core_forecast_revision(p_user_id uuid,p_published_version_id uuid,
  p_as_of_date date,p_start_date date,p_starting_included_cash numeric,p_minimum_reserve numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_old public.cash_forecast_versions%ROWTYPE; v_existing public.cash_forecast_versions%ROWTYPE;
  v_business uuid; v_result jsonb; v_new uuid; v_updated timestamptz;
BEGIN
  SELECT * INTO v_old FROM public.cash_forecast_versions WHERE id=p_published_version_id AND user_id=p_user_id AND case_type='base';
  IF NOT FOUND THEN RAISE EXCEPTION 'Published base forecast not found' USING ERRCODE='P0002'; END IF;
  SELECT business_id INTO v_business FROM public.cash_forecasts WHERE id=v_old.forecast_id AND user_id=p_user_id;
  PERFORM 1 FROM public.business_profiles WHERE id=v_business AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.cash_forecasts WHERE id=v_old.forecast_id AND user_id=p_user_id FOR UPDATE;
  SELECT * INTO v_old FROM public.cash_forecast_versions WHERE id=p_published_version_id AND user_id=p_user_id FOR UPDATE;
  IF v_old.status<>'published' THEN RAISE EXCEPTION 'Published base changed; reload before revising' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_existing FROM public.cash_forecast_versions WHERE forecast_id=v_old.forecast_id AND user_id=p_user_id AND case_type='base' AND status='draft';
  IF FOUND THEN
    IF v_existing.parent_version_id IS DISTINCT FROM v_old.id THEN RAISE EXCEPTION 'Another weekly plan draft already exists' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('forecast_id',v_existing.forecast_id,'version_id',v_existing.id,'version_number',v_existing.version_number,
      'status','draft','updated_at',v_existing.updated_at,'reused',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.cash_forecast_schedules WHERE version_id=v_old.id)
    OR EXISTS(SELECT 1 FROM public.cash_forecast_assumptions WHERE version_id=v_old.id) THEN
    RAISE EXCEPTION 'Core revision cannot copy advanced forecast records' USING ERRCODE='0A000'; END IF;
  v_result:=public.begin_cash_forecast_draft(p_user_id,v_business,
    (SELECT reporting_currency FROM public.cash_forecasts WHERE id=v_old.forecast_id),p_as_of_date,p_start_date,
    p_starting_included_cash,v_old.starting_unavailable_cash,p_minimum_reserve,v_old.source_data_version,v_old.formula_policy_version,v_old.source_snapshot,v_old.id);
  v_new:=(v_result->>'version_id')::uuid;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,counterparty,amount,direction,category,expected_date,
    status,confidence,amount_is_estimated,date_is_estimated,zero_confirmed,source_type,source_reference,source_updated_at,evidence,created_by,updated_by)
  SELECT v_new,p_user_id,item_key,description,counterparty,amount,direction,category,expected_date,
    CASE WHEN status IN ('paid','received','cancelled') THEN 'excluded' ELSE status END,confidence,
    amount_is_estimated,date_is_estimated,zero_confirmed,source_type,source_reference,source_updated_at,evidence,p_user_id,p_user_id
    FROM public.cash_forecast_items WHERE version_id=v_old.id;
  SELECT updated_at INTO v_updated FROM public.cash_forecast_versions WHERE id=v_new;
  RETURN v_result||jsonb_build_object('updated_at',v_updated,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric) TO service_role;
COMMIT;
