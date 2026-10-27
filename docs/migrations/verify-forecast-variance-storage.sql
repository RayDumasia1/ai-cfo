-- PREVIEW ONLY. Supply dedicated existing accounts through session settings:
-- SELECT set_config('app.preview_account_a','<uuid>',false);
-- SELECT set_config('app.preview_account_b','<uuid>',false);
-- SELECT set_config('app.preview_confirmed','true',false);
-- All fixtures roll back, including the archived verification forecast.
BEGIN;
DO $$
DECLARE
  a uuid:=current_setting('app.preview_account_a')::uuid;
  b uuid:=current_setting('app.preview_account_b')::uuid;
  business uuid; forecast uuid; version uuid; item uuid; event uuid; review uuid;
  stamp timestamptz; payload jsonb; receipt jsonb; evidence jsonb; allocations jsonb;
  result jsonb:='{"valid":true,"coverage":"complete","policyVersion":"variance-1"}';
  policy jsonb:='{"version":"variance-1","currencyPrecision":2,"absoluteAmountThreshold":100,"percentageOfPlannedThreshold":0.1,"timingDaysThreshold":2}';
  request uuid:=gen_random_uuid(); saved jsonb; retry jsonb; blocked boolean; before_b jsonb;
BEGIN
  IF current_user<>'postgres' OR current_setting('app.preview_confirmed')<>'true' OR a=b THEN
    RAISE EXCEPTION 'Confirm preview and two distinct dedicated accounts; run as postgres'; END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(a,b))<>2 THEN RAISE EXCEPTION 'Accounts must exist'; END IF;
  SELECT id INTO business FROM public.business_profiles WHERE user_id=a;
  IF business IS NULL THEN RAISE EXCEPTION 'Account A requires a profile'; END IF;
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO before_b FROM public.cash_actual_events e WHERE user_id=b;
  ASSERT NOT has_table_privilege('service_role','public.cash_actual_events','INSERT');
  ASSERT NOT has_table_privilege('authenticated','public.cash_forecast_reviews','INSERT');
  ASSERT NOT has_table_privilege('anon','public.cash_actual_events','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.save_cash_forecast_review(uuid,uuid,date,uuid,text,jsonb,jsonb,numeric,numeric,jsonb)','EXECUTE');

  INSERT INTO public.cash_forecasts(user_id,business_id,name,reporting_currency,archived_at)
    VALUES(a,business,'FORECAST-01E3 rollback verification','USD',now()) RETURNING id INTO forecast;
  INSERT INTO public.cash_forecast_versions(forecast_id,user_id,version_number,as_of_date,start_date,starting_included_cash,formula_policy_version,created_by)
    VALUES(forecast,a,1,current_date-14,current_date-14,1000,'forecast-1',a) RETURNING id INTO version;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,created_by,updated_by)
    VALUES(version,a,'invoice','Verification receipt',100,'inflow','customer_receipt',current_date-13,'confirmed','confirmed','manual',a,a) RETURNING id INTO item;
  SELECT updated_at INTO stamp FROM public.cash_forecast_versions WHERE id=version;
  PERFORM public.publish_cash_forecast_version(a,forecast,version,'{"verification":true}',stamp);
  payload:=jsonb_build_object('reporting_currency','USD','cash_date',current_date-13,'amount',90,'direction','inflow',
    'category','customer_receipt','source_type','manual','source_connection','rollback-verifier','source_event_id',request,
    'ingestion_batch','verification','payload_fingerprint','receipt-90','lineage','{}'::jsonb,'manual_entry',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  receipt:=public.record_cash_actual_event(a,business,payload);
  event:=(receipt->>'event_id')::uuid;
  ASSERT public.record_cash_actual_event(a,business,payload)->>'event_id'=event::text;
  evidence:=public.cash_forecast_review_evidence(a,version,current_date-14);
  -- Other real cash events in this account's week remain visible. Keep the
  -- fixture partial when they exist; never make assumptions about customer data.
  IF jsonb_array_length(evidence->'actual_events')>1 THEN result:=jsonb_set(result,'{coverage}','"partial"'); END IF;
  allocations:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'plannedItemId',item,'actualEventId',event,
    'plannedAmount',100,'actualAmount',90,'resolution','matched','method','user_confirmed','confidence','confirmed',
    'rationale','Rollback-only verification','matchingPolicyVersion','matching-1'));
  saved:=public.save_cash_forecast_review(a,version,current_date-14,request,evidence->>'evidence_token',allocations,policy,1000,1090,result);
  review:=(saved->>'review_id')::uuid;
  retry:=public.save_cash_forecast_review(a,version,current_date-14,request,evidence->>'evidence_token',allocations,policy,1000,1090,result);
  ASSERT retry->>'replayed'='true' AND retry->>'review_id'=review::text;
  blocked:=false;
  BEGIN
    PERFORM public.save_cash_forecast_review(a,version,current_date-14,gen_random_uuid(),evidence->>'evidence_token',allocations,policy,1000,1090,result);
  EXCEPTION WHEN serialization_failure THEN blocked:=true; END;
  ASSERT blocked,'Stale review head accepted';
  evidence:=public.cash_forecast_review_evidence(a,version,current_date-14);
  blocked:=false;
  BEGIN
    PERFORM public.save_cash_forecast_review(a,version,current_date-14,gen_random_uuid(),evidence->>'evidence_token',
      jsonb_set(allocations,'{0,actualAmount}','91'),policy,1000,1090,result);
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  ASSERT blocked,'Over-allocation accepted';
  -- A late allocation constraint failure must roll back its review header too.
  blocked:=false;
  BEGIN
    PERFORM public.save_cash_forecast_review(a,version,current_date-14,gen_random_uuid(),evidence->>'evidence_token',
      jsonb_set(allocations,'{0,rationale}','""'),policy,1000,1090,result);
  EXCEPTION WHEN check_violation THEN blocked:=true; END;
  ASSERT blocked,'Invalid allocation accepted';
  ASSERT (SELECT count(*) FROM public.cash_forecast_reviews WHERE version_id=version)=1;
  receipt:=public.record_cash_actual_event(a,business,jsonb_set(payload,'{amount}','95'),event);
  ASSERT receipt->>'revision'='2';
  ASSERT (SELECT source_snapshot->'actual_events' @> jsonb_build_array(jsonb_build_object('id',event,'amount',90))
    FROM public.cash_forecast_reviews WHERE id=review),'Earlier evidence was changed';
  EXECUTE 'RESET ROLE';
  blocked:=false;
  BEGIN UPDATE public.cash_forecast_reviews SET coverage='unknown' WHERE id=review;
  EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true; END;
  ASSERT blocked,'History mutation accepted';
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS(SELECT 1 FROM public.cash_forecast_reviews WHERE id=review),'Cross-account review exposed';
  ASSERT NOT EXISTS(SELECT 1 FROM public.cash_actual_events WHERE id=event),'Cross-account event exposed';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT EXISTS(SELECT 1 FROM public.cash_forecast_reviews WHERE id=review),'Owner cannot read review';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.cash_actual_events e WHERE user_id=b) IS NOT DISTINCT FROM before_b;
  RAISE NOTICE 'PASS: variance storage, retry, stale protection, limits, rollback, history and RLS';
END $$;
ROLLBACK;
