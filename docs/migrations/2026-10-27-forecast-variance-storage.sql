-- FORECAST-01E3. Apply to PREVIEW first. Additive; no existing records change.
BEGIN;
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres'; END IF;
END $$;

CREATE TABLE public.cash_actual_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.business_profiles(id),
  reporting_currency text NOT NULL CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  cash_date date NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric),
  direction text NOT NULL CHECK (direction IN ('inflow','outflow')),
  category text CHECK (category IN ('customer_receipt','operating_vendor_payment','payroll','tax','debt_principal','debt_interest','owner_distribution','asset_purchase','asset_proceeds','new_debt','owner_equity_funding','other_cash_in','other_cash_out')),
  source_type text NOT NULL CHECK (source_type IN ('manual','spreadsheet','quickbooks','banking','other_provider')),
  source_connection text NOT NULL CHECK (length(source_connection) BETWEEN 1 AND 200),
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 500),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  ingestion_batch text NOT NULL CHECK (length(ingestion_batch) BETWEEN 1 AND 200),
  payload_fingerprint text NOT NULL CHECK (length(payload_fingerprint) BETWEEN 1 AND 200),
  lineage jsonb NOT NULL CHECK (jsonb_typeof(lineage)='object' AND pg_column_size(lineage)<=131072),
  manual_entry boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id uuid UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,user_id),
  UNIQUE(user_id,source_type,source_connection,source_event_id,revision),
  FOREIGN KEY(supersedes_id,user_id) REFERENCES public.cash_actual_events(id,user_id),
  CHECK (manual_entry = (source_type='manual')),
  CHECK ((revision=1 AND supersedes_id IS NULL) OR (revision>1 AND supersedes_id IS NOT NULL)),
  CHECK (category IS NULL OR (direction='inflow' AND category IN ('customer_receipt','asset_proceeds','new_debt','owner_equity_funding','other_cash_in')) OR (direction='outflow' AND category IN ('operating_vendor_payment','payroll','tax','debt_principal','debt_interest','owner_distribution','asset_purchase','other_cash_out')))
);
CREATE INDEX cash_actual_events_week ON public.cash_actual_events(user_id,business_id,reporting_currency,cash_date);

CREATE TABLE public.cash_forecast_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  week_start date NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  previous_review_id uuid,
  request_key uuid NOT NULL,
  request_payload jsonb NOT NULL CHECK (pg_column_size(request_payload)<=1048576),
  evidence_token text NOT NULL,
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot)='object' AND pg_column_size(source_snapshot)<=2097152),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
  calculation_result jsonb NOT NULL CHECK (jsonb_typeof(calculation_result)='object' AND pg_column_size(calculation_result)<=1048576),
  coverage text NOT NULL CHECK (coverage IN ('complete','partial','unknown')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,version_id,user_id),
  UNIQUE(version_id,week_start,revision),
  UNIQUE(user_id,request_key),
  FOREIGN KEY(version_id,user_id) REFERENCES public.cash_forecast_versions(id,user_id),
  FOREIGN KEY(previous_review_id,version_id,user_id) REFERENCES public.cash_forecast_reviews(id,version_id,user_id)
);

CREATE TABLE public.cash_forecast_review_allocations (
  id uuid NOT NULL,
  review_id uuid NOT NULL,
  version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  planned_item_id uuid,
  actual_event_id uuid,
  planned_amount numeric(20,4) NOT NULL CHECK (planned_amount>=0 AND planned_amount<'Infinity'::numeric),
  actual_amount numeric(20,4) NOT NULL CHECK (actual_amount>=0 AND actual_amount<'Infinity'::numeric),
  resolution text NOT NULL CHECK (resolution IN ('matched','cancelled','missed','unplanned','unresolved')),
  method text NOT NULL CHECK (method IN ('source_identity','deterministic_rule','user_confirmed','advisor_confirmed')),
  confidence text NOT NULL CHECK (confidence IN ('confirmed','high','medium','low','unknown')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 2000),
  matching_policy_version text NOT NULL CHECK (length(matching_policy_version) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(review_id,id),
  FOREIGN KEY(review_id,version_id,user_id) REFERENCES public.cash_forecast_reviews(id,version_id,user_id),
  FOREIGN KEY(planned_item_id,version_id,user_id) REFERENCES public.cash_forecast_items(id,version_id,user_id),
  FOREIGN KEY(actual_event_id,user_id) REFERENCES public.cash_actual_events(id,user_id),
  CHECK ((resolution='matched' AND planned_item_id IS NOT NULL AND actual_event_id IS NOT NULL)
    OR (resolution IN ('cancelled','missed') AND planned_item_id IS NOT NULL AND actual_event_id IS NULL AND actual_amount=0)
    OR (resolution='unplanned' AND planned_item_id IS NULL AND actual_event_id IS NOT NULL AND planned_amount=0)
    OR (resolution='unresolved' AND (planned_item_id IS NOT NULL OR actual_event_id IS NOT NULL))),
  CHECK (planned_item_id IS NOT NULL OR planned_amount=0),
  CHECK (actual_event_id IS NOT NULL OR actual_amount=0)
);

CREATE FUNCTION public.guard_cash_review_history() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Cash evidence and review history are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER cash_actual_events_immutable BEFORE UPDATE OR DELETE ON public.cash_actual_events FOR EACH ROW EXECUTE FUNCTION public.guard_cash_review_history();
CREATE TRIGGER cash_forecast_reviews_immutable BEFORE UPDATE OR DELETE ON public.cash_forecast_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_cash_review_history();
CREATE TRIGGER cash_forecast_review_allocations_immutable BEFORE UPDATE OR DELETE ON public.cash_forecast_review_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_cash_review_history();

-- Every writer takes the business row first. This serializes ingestion/corrections
-- with review saves, including different forecast versions for the same account.
CREATE FUNCTION public.record_cash_actual_event(p_user_id uuid,p_business_id uuid,p_event jsonb,p_expected_head uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.cash_actual_events%ROWTYPE; e public.cash_actual_events%ROWTYPE; v_id uuid;
BEGIN
  PERFORM 1 FROM public.business_profiles WHERE id=p_business_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found' USING ERRCODE='P0002'; END IF;
  IF p_event IS NULL OR jsonb_typeof(p_event)<>'object' OR pg_column_size(p_event)>140000 THEN
    RAISE EXCEPTION 'Invalid actual event' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM jsonb_populate_record(NULL::public.cash_actual_events,p_event);
  SELECT * INTO h FROM public.cash_actual_events a WHERE a.user_id=p_user_id
    AND a.source_type=e.source_type AND a.source_connection=e.source_connection AND a.source_event_id=e.source_event_id
    ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  -- Retry is only identical when all supplied financial and source evidence agrees.
  IF h.id IS NOT NULL AND h.business_id=p_business_id
    AND (to_jsonb(h)-ARRAY['id','user_id','business_id','created_at','created_by','revision','supersedes_id','ingestion_batch'])
      = (to_jsonb(e)-ARRAY['id','user_id','business_id','created_at','created_by','revision','supersedes_id','ingestion_batch']) THEN
    RETURN jsonb_build_object('event_id',h.id,'revision',h.revision,'replayed',true);
  END IF;
  IF h.id IS DISTINCT FROM p_expected_head THEN
    RAISE EXCEPTION 'Actual evidence changed; reload before correcting' USING ERRCODE='40001'; END IF;
  IF h.id IS NOT NULL AND (h.business_id<>p_business_id OR h.reporting_currency<>e.reporting_currency) THEN
    RAISE EXCEPTION 'Correction cannot change business or currency' USING ERRCODE='23514'; END IF;
  INSERT INTO public.cash_actual_events(user_id,business_id,reporting_currency,cash_date,amount,direction,category,
    source_type,source_connection,source_event_id,source_created_at,source_updated_at,ingestion_batch,payload_fingerprint,
    lineage,manual_entry,revision,supersedes_id,created_by)
  VALUES(p_user_id,p_business_id,e.reporting_currency,e.cash_date,e.amount,e.direction,e.category,
    e.source_type,e.source_connection,e.source_event_id,e.source_created_at,e.source_updated_at,e.ingestion_batch,e.payload_fingerprint,
    e.lineage,e.manual_entry,coalesce(h.revision,0)+1,h.id,p_user_id) RETURNING id INTO v_id;
  RETURN jsonb_build_object('event_id',v_id,'revision',coalesce(h.revision,0)+1,'replayed',false);
END $$;

-- A deterministic, complete snapshot is returned to the trusted server engine.
-- The token covers effective event revisions, immutable plan evidence and review head.
CREATE FUNCTION public.cash_forecast_review_evidence(p_user_id uuid,p_version_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cash_forecast_versions%ROWTYPE; f public.cash_forecasts%ROWTYPE; s jsonb; p jsonb; a jsonb; r integer;
BEGIN
  SELECT * INTO v FROM public.cash_forecast_versions WHERE id=p_version_id AND user_id=p_user_id AND status IN ('published','superseded');
  IF NOT FOUND THEN RAISE EXCEPTION 'Published version not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO f FROM public.cash_forecasts WHERE id=v.forecast_id AND user_id=p_user_id;
  IF p_week_start IS NULL OR p_week_start<v.start_date OR p_week_start>=v.start_date+91
    OR (p_week_start-v.start_date)%7<>0 OR p_week_start+6>=current_date THEN
    RAISE EXCEPTION 'Choose a closed forecast week' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') INTO p FROM public.cash_forecast_items i
    WHERE version_id=p_version_id AND user_id=p_user_id AND expected_date BETWEEN p_week_start AND p_week_start+6
      AND status NOT IN ('cancelled','excluded');
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO a FROM public.cash_actual_events e
    WHERE e.user_id=p_user_id AND e.business_id=f.business_id AND e.reporting_currency=f.reporting_currency
      AND e.cash_date BETWEEN p_week_start AND p_week_start+6
      AND NOT EXISTS(SELECT 1 FROM public.cash_actual_events newer WHERE newer.supersedes_id=e.id);
  IF jsonb_array_length(p)>2000 OR jsonb_array_length(a)>2000 THEN
    RAISE EXCEPTION 'Review evidence exceeds supported size' USING ERRCODE='54000'; END IF;
  SELECT coalesce(max(revision),0) INTO r FROM public.cash_forecast_reviews WHERE version_id=p_version_id AND week_start=p_week_start AND user_id=p_user_id;
  s:=jsonb_build_object('version_id',v.id,'business_id',f.business_id,'week_start',p_week_start,'week_end',p_week_start+6,
    'reporting_currency',f.reporting_currency,'minimum_reserve',v.minimum_reserve,'formula_policy_version',v.formula_policy_version,
    'plan_source_snapshot',v.source_snapshot,'planned_items',p,'actual_events',a,'review_revision',r);
  RETURN s || jsonb_build_object('evidence_token',md5(s::text));
END $$;

CREATE FUNCTION public.save_cash_forecast_review(p_user_id uuid,p_version_id uuid,p_week_start date,
  p_request_key uuid,p_evidence_token text,p_allocations jsonb,p_policy jsonb,p_opening_cash numeric,p_closing_cash numeric,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb; request jsonb; old public.cash_forecast_reviews%ROWTYPE; v_review uuid; v_previous uuid;
  v_business uuid; v_revision integer; v_allocation jsonb; v_item jsonb; v_event jsonb; v_in numeric; v_out numeric; v_complete boolean;
BEGIN
  SELECT f.business_id INTO v_business FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id
    WHERE v.id=p_version_id AND v.user_id=p_user_id AND f.user_id=p_user_id;
  PERFORM 1 FROM public.business_profiles WHERE id=v_business AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.cash_forecast_versions WHERE id=p_version_id AND user_id=p_user_id FOR UPDATE;
  request:=jsonb_build_object('version',p_version_id,'week',p_week_start,'token',p_evidence_token,'allocations',p_allocations,
    'policy',p_policy,'opening',p_opening_cash,'closing',p_closing_cash,'result',p_result);
  SELECT * INTO old FROM public.cash_forecast_reviews WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF old.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Request key reused with different evidence' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('review_id',old.id,'revision',old.revision,'coverage',old.coverage,'replayed',true);
  END IF;
  s:=public.cash_forecast_review_evidence(p_user_id,p_version_id,p_week_start);
  IF p_evidence_token IS DISTINCT FROM s->>'evidence_token' THEN
    RAISE EXCEPTION 'Review evidence changed; reload and recalculate' USING ERRCODE='40001'; END IF;
  IF p_request_key IS NULL OR p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)>4000
    OR p_policy IS NULL OR jsonb_typeof(p_policy)<>'object' OR length(coalesce(p_policy->>'version','')) NOT BETWEEN 1 AND 80
    OR p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR p_result->>'valid' IS DISTINCT FROM 'true'
    OR p_result->>'policyVersion' IS DISTINCT FROM p_policy->>'version'
    OR coalesce(p_result->>'coverage','') NOT IN ('complete','partial','unknown')
    OR (p_opening_cash IS NULL)<>(p_closing_cash IS NULL)
    OR p_opening_cash<0 OR p_closing_cash<0 OR p_opening_cash>='Infinity'::numeric OR p_closing_cash>='Infinity'::numeric THEN
    RAISE EXCEPTION 'Invalid review payload' USING ERRCODE='22023'; END IF;
  -- Lock all selected evidence in a stable order under the shared business lock.
  PERFORM 1 FROM public.cash_actual_events WHERE user_id=p_user_id AND id IN
    (SELECT (value->>'id')::uuid FROM jsonb_array_elements(s->'actual_events')) ORDER BY id FOR UPDATE;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF (v_allocation->>'plannedAmount')::numeric IS DISTINCT FROM round((v_allocation->>'plannedAmount')::numeric,4)
      OR (v_allocation->>'actualAmount')::numeric IS DISTINCT FROM round((v_allocation->>'actualAmount')::numeric,4) THEN
      RAISE EXCEPTION 'Allocation precision exceeds cash evidence precision' USING ERRCODE='23514'; END IF;
    SELECT value INTO v_item FROM jsonb_array_elements(s->'planned_items') WHERE value->>'id'=v_allocation->>'plannedItemId';
    SELECT value INTO v_event FROM jsonb_array_elements(s->'actual_events') WHERE value->>'id'=v_allocation->>'actualEventId';
    IF (v_allocation->>'plannedItemId' IS NOT NULL AND v_item IS NULL) OR (v_allocation->>'actualEventId' IS NOT NULL AND v_event IS NULL)
      OR (v_item IS NOT NULL AND v_event IS NOT NULL AND v_item->>'direction'<>v_event->>'direction') THEN
      RAISE EXCEPTION 'Allocation must reference same-week, same-account, same-currency evidence and direction' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'planned_items') i WHERE
    (SELECT coalesce(sum((x->>'plannedAmount')::numeric),0) FROM jsonb_array_elements(p_allocations) x WHERE x->>'plannedItemId'=i->>'id')>(i->>'amount')::numeric)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'actual_events') e WHERE
    (SELECT coalesce(sum((x->>'actualAmount')::numeric),0) FROM jsonb_array_elements(p_allocations) x WHERE x->>'actualEventId'=e->>'id')>(e->>'amount')::numeric) THEN
    RAISE EXCEPTION 'Allocation exceeds available evidence' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum((value->>'amount')::numeric) FILTER(WHERE value->>'direction'='inflow'),0),
    coalesce(sum((value->>'amount')::numeric) FILTER(WHERE value->>'direction'='outflow'),0) INTO v_in,v_out FROM jsonb_array_elements(s->'actual_events');
  v_complete:=p_opening_cash IS NOT NULL AND p_closing_cash IS NOT NULL AND abs(p_opening_cash+v_in-v_out-p_closing_cash)<=0.005
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) x WHERE x->>'resolution'='unresolved')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'planned_items') i WHERE abs((i->>'amount')::numeric-
      (SELECT coalesce(sum((x->>'plannedAmount')::numeric),0) FROM jsonb_array_elements(p_allocations) x WHERE x->>'plannedItemId'=i->>'id'))>0.005)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'actual_events') e WHERE abs((e->>'amount')::numeric-
      (SELECT coalesce(sum((x->>'actualAmount')::numeric),0) FROM jsonb_array_elements(p_allocations) x WHERE x->>'actualEventId'=e->>'id'))>0.005);
  IF p_result->>'coverage'='complete' AND NOT v_complete THEN
    RAISE EXCEPTION 'Unresolved or unreconciled evidence cannot be complete' USING ERRCODE='23514'; END IF;
  v_revision:=(s->>'review_revision')::integer+1;
  SELECT id INTO v_previous FROM public.cash_forecast_reviews WHERE user_id=p_user_id AND version_id=p_version_id AND week_start=p_week_start ORDER BY revision DESC LIMIT 1;
  INSERT INTO public.cash_forecast_reviews(user_id,version_id,week_start,revision,previous_review_id,request_key,request_payload,
    evidence_token,source_snapshot,policy,calculation_result,coverage,created_by)
  VALUES(p_user_id,p_version_id,p_week_start,v_revision,v_previous,p_request_key,request,p_evidence_token,
    s || jsonb_build_object('actual_opening_cash',p_opening_cash,'actual_closing_cash',p_closing_cash),p_policy,p_result,p_result->>'coverage',p_user_id) RETURNING id INTO v_review;
  INSERT INTO public.cash_forecast_review_allocations(id,review_id,version_id,user_id,planned_item_id,actual_event_id,
    planned_amount,actual_amount,resolution,method,confidence,rationale,matching_policy_version,created_by)
  SELECT (x->>'id')::uuid,v_review,p_version_id,p_user_id,(x->>'plannedItemId')::uuid,(x->>'actualEventId')::uuid,
    (x->>'plannedAmount')::numeric,(x->>'actualAmount')::numeric,x->>'resolution',x->>'method',x->>'confidence',x->>'rationale',x->>'matchingPolicyVersion',p_user_id
  FROM jsonb_array_elements(p_allocations) x;
  RETURN jsonb_build_object('review_id',v_review,'revision',v_revision,'coverage',p_result->>'coverage','replayed',false);
END $$;

ALTER TABLE public.cash_actual_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_actual_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_review_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_review_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_actual_events_owner_read ON public.cash_actual_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY cash_forecast_reviews_owner_read ON public.cash_forecast_reviews FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY cash_forecast_review_allocations_owner_read ON public.cash_forecast_review_allocations FOR SELECT TO authenticated USING(auth.uid()=user_id);
REVOKE ALL ON public.cash_actual_events,public.cash_forecast_reviews,public.cash_forecast_review_allocations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cash_actual_events,public.cash_forecast_reviews,public.cash_forecast_review_allocations TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_cash_review_history(),public.record_cash_actual_event(uuid,uuid,jsonb,uuid),public.cash_forecast_review_evidence(uuid,uuid,date),public.save_cash_forecast_review(uuid,uuid,date,uuid,text,jsonb,jsonb,numeric,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_cash_actual_event(uuid,uuid,jsonb,uuid),public.cash_forecast_review_evidence(uuid,uuid,date),public.save_cash_forecast_review(uuid,uuid,date,uuid,text,jsonb,jsonb,numeric,numeric,jsonb) TO service_role;
COMMIT;
