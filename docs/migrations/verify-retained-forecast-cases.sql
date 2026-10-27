-- PREVIEW ONLY; rollback-only fixture. Uses the same app.preview_* settings as
-- the E3 verifier. Synthetic result fixtures test storage, not financial math.
BEGIN;
DO $$
DECLARE a uuid:=current_setting('app.preview_account_a')::uuid; b uuid:=current_setting('app.preview_account_b')::uuid;
  business uuid; forecast uuid; source_version uuid; item uuid; first_case jsonb; second_case jsonb; assumptions jsonb;
  result jsonb; baseline jsonb; stamp timestamptz; request uuid:=gen_random_uuid(); blocked boolean; before_b jsonb;
BEGIN
  IF current_user<>'postgres' OR current_setting('app.preview_confirmed')<>'true' OR a=b
    OR (SELECT count(*) FROM auth.users WHERE id IN(a,b))<>2 THEN RAISE EXCEPTION 'Confirm preview and two dedicated accounts; run as postgres'; END IF;
  SELECT id INTO business FROM public.business_profiles WHERE user_id=a;
  IF business IS NULL THEN RAISE EXCEPTION 'Account A needs a business profile'; END IF;
  ASSERT has_function_privilege('service_role','public.save_cash_forecast_case(uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,date)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.save_cash_forecast_case(uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,date)','EXECUTE');
  ASSERT NOT has_function_privilege('anon','public.save_cash_forecast_case(uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,date)','EXECUTE');
  SELECT jsonb_agg(to_jsonb(v) ORDER BY id) INTO before_b FROM public.cash_forecast_versions v WHERE user_id=b;
  INSERT INTO public.cash_forecasts(user_id,business_id,name,reporting_currency,archived_at)
    VALUES(a,business,'E5 rollback verification','USD',now()) RETURNING id INTO forecast;
  INSERT INTO public.cash_forecast_versions(forecast_id,user_id,version_number,as_of_date,start_date,starting_included_cash,minimum_reserve,formula_policy_version,created_by)
    VALUES(forecast,a,1,current_date,current_date,1000,400,'forecast-1',a) RETURNING id INTO source_version;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,created_by,updated_by)
    VALUES(source_version,a,'receipt','Verification receipt',100,'inflow','customer_receipt',current_date+1,'confirmed','confirmed','manual',a,a) RETURNING id INTO item;
  SELECT updated_at INTO stamp FROM public.cash_forecast_versions WHERE id=source_version;
  SELECT jsonb_build_object('valid',true,'weeks',jsonb_agg(jsonb_build_object('weekStart',current_date+7*g,'endingCash',1080) ORDER BY g),
    'summary',jsonb_build_object('endingCash',1080)) INTO result FROM generate_series(0,12) g;
  baseline:=jsonb_set(result,'{summary,endingCash}','1100');
  PERFORM public.publish_cash_forecast_version(a,forecast,source_version,baseline,stamp);
  assumptions:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Partial receipt','operation','amount_multiplier','value',0.8,
    'itemIds',jsonb_build_array(item),'rationale','Rollback-only fixture'));
  EXECUTE 'SET LOCAL ROLE service_role';
  first_case:=public.save_cash_forecast_case(a,source_version,'downside','Receipt case',request,assumptions,result,baseline,current_date);
  ASSERT public.save_cash_forecast_case(a,source_version,'downside','Receipt case',request,assumptions,result,baseline,current_date)->>'replayed'='true';
  ASSERT (SELECT status='published' AND starting_included_cash=1000 AND calculation_result=baseline FROM public.cash_forecast_versions WHERE id=source_version);
  ASSERT (SELECT count(*)=1 FROM public.cash_forecast_items WHERE version_id=(first_case->>'version_id')::uuid AND amount=100 AND evidence->>'case_base_item_id'=item::text);
  ASSERT (SELECT count(*)=1 FROM public.cash_forecast_assumption_items WHERE version_id=(first_case->>'version_id')::uuid);
  blocked:=false;
  BEGIN PERFORM public.save_cash_forecast_case(a,source_version,'downside','Changed name',request,assumptions,result,baseline,current_date);
  EXCEPTION WHEN invalid_parameter_value THEN blocked:=true; END; ASSERT blocked,'Changed replay accepted';
  blocked:=false;
  BEGIN PERFORM public.save_cash_forecast_case(b,source_version,'downside','Cross-account',gen_random_uuid(),assumptions,result,baseline,current_date);
  EXCEPTION WHEN no_data_found THEN blocked:=true; END; ASSERT blocked,'Cross-account base accepted';
  blocked:=false;
  BEGIN PERFORM public.save_cash_forecast_case(a,source_version,'downside','Foreign item',gen_random_uuid(),
    jsonb_set(assumptions,'{0,itemIds}',jsonb_build_array(gen_random_uuid())),result,baseline,current_date);
  EXCEPTION WHEN check_violation THEN blocked:=true; END; ASSERT blocked,'Foreign item accepted';
  blocked:=false;
  BEGIN PERFORM public.save_cash_forecast_case(a,source_version,'downside','Late failure',gen_random_uuid(),assumptions,
    result||jsonb_build_object('padding',repeat('x',600000)),baseline,current_date);
  EXCEPTION WHEN invalid_parameter_value THEN blocked:=true; END; ASSERT blocked,'Late publication failure not enforced';
  ASSERT (SELECT count(*)=2 FROM public.cash_forecast_versions WHERE forecast_id=forecast),'Failed case left a partial version';
  second_case:=public.save_cash_forecast_case(a,source_version,'downside','Receipt case v2',gen_random_uuid(),assumptions,result,baseline,current_date);
  ASSERT (SELECT status='superseded' FROM public.cash_forecast_versions WHERE id=(first_case->>'version_id')::uuid);
  EXECUTE 'RESET ROLE';
  blocked:=false;
  BEGIN UPDATE public.cash_forecast_versions SET case_name='Changed' WHERE id=(first_case->>'version_id')::uuid;
  EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true; END; ASSERT blocked,'Saved history changed';
  UPDATE public.cash_forecast_versions SET status='superseded',superseded_at=now() WHERE id=source_version;
  EXECUTE 'SET LOCAL ROLE service_role'; blocked:=false;
  BEGIN PERFORM public.save_cash_forecast_case(a,source_version,'upside','Outdated base',gen_random_uuid(),assumptions,result,baseline,current_date);
  EXCEPTION WHEN serialization_failure THEN blocked:=true; END; ASSERT blocked,'Outdated base accepted';
  ASSERT public.save_cash_forecast_case(a,source_version,'downside','Receipt case',request,assumptions,result,baseline,current_date)->>'replayed'='true';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',b::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS(SELECT 1 FROM public.cash_forecast_versions WHERE id=(first_case->>'version_id')::uuid),'Cross-account case exposed';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',a::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT EXISTS(SELECT 1 FROM public.cash_forecast_versions WHERE id=(first_case->>'version_id')::uuid),'Owner cannot read case';
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.cash_forecast_versions v WHERE user_id=b) IS NOT DISTINCT FROM before_b;
  RAISE NOTICE 'PASS: saved cases preserve base and history, scope source items, replay once and roll back failed publication';
END $$;
ROLLBACK;
