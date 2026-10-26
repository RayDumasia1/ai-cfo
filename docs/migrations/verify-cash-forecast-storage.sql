-- PREVIEW ONLY. Never run in production. Rolls back all fixture changes.
-- Replace the two zero UUID values, set preview_confirmed=true, and run as postgres.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean := false;
  v_account_a uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_account_b uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  business_a uuid;
  draft_one jsonb;
  draft_two jsonb;
  v_forecast_id uuid;
  version_one uuid;
  version_two uuid;
  version_one_updated_at timestamptz;
  version_two_updated_at timestamptz;
  item_id uuid;
  blocked boolean := false;
  other_before jsonb;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed
     OR v_account_a='00000000-0000-0000-0000-000000000000'::uuid
     OR v_account_b='00000000-0000-0000-0000-000000000000'::uuid
     OR v_account_a=v_account_b THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply two distinct dedicated preview-account UUIDs; run as postgres';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN(v_account_a,v_account_b))<>2 THEN RAISE EXCEPTION 'Both preview accounts must exist'; END IF;
  SELECT id INTO business_a FROM public.business_profiles WHERE user_id=v_account_a;
  IF business_a IS NULL THEN RAISE EXCEPTION 'Account A needs a business profile'; END IF;

  ASSERT has_function_privilege('service_role','public.begin_cash_forecast_draft(uuid,uuid,text,date,date,numeric,numeric,numeric,text,text,jsonb,uuid)','EXECUTE');
  ASSERT has_function_privilege('service_role','public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz)','EXECUTE');
  ASSERT has_table_privilege('authenticated','public.cash_forecasts','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.cash_forecasts','INSERT');
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO other_before FROM public.cash_forecasts f WHERE user_id=v_account_b;

  EXECUTE 'SET LOCAL ROLE service_role';
  draft_one:=public.begin_cash_forecast_draft(v_account_a,business_a,'USD','2026-10-25','2026-10-25',100000,5000,25000,'fixture-v1','forecast-1','{"source":"verification"}',NULL);
  v_forecast_id:=(draft_one->>'forecast_id')::uuid;
  version_one:=(draft_one->>'version_id')::uuid;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,created_by,updated_by)
    VALUES(version_one,v_account_a,'invoice-1','Expected customer receipt',20000,'inflow','customer_receipt','2026-10-30','expected','high','manual',v_account_a,v_account_a)
    RETURNING id INTO item_id;
  SELECT updated_at INTO version_one_updated_at FROM public.cash_forecast_versions WHERE id=version_one;
  PERFORM public.publish_cash_forecast_version(v_account_a,v_forecast_id,version_one,'{"weeks":13,"endingCash":120000}',version_one_updated_at);
  EXECUTE 'RESET ROLE';

  ASSERT (SELECT status='published' AND calculation_result->>'weeks'='13' FROM public.cash_forecast_versions WHERE id=version_one);
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    UPDATE public.cash_forecast_items SET amount=1 WHERE id=item_id;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    blocked:=true;
    EXECUTE 'RESET ROLE';
  END;
  ASSERT blocked, 'Published child mutation was not blocked';

  EXECUTE 'SET LOCAL ROLE service_role';
  draft_two:=public.begin_cash_forecast_draft(v_account_a,business_a,'USD','2026-10-25','2026-10-25',100000,5000,25000,'fixture-v2','forecast-1','{"source":"verification"}',version_one);
  version_two:=(draft_two->>'version_id')::uuid;
  SELECT updated_at INTO version_two_updated_at FROM public.cash_forecast_versions WHERE id=version_two;
  PERFORM public.publish_cash_forecast_version(v_account_a,v_forecast_id,version_two,'{"weeks":13,"endingCash":100000}',version_two_updated_at);
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT status='superseded' FROM public.cash_forecast_versions WHERE id=version_one);
  ASSERT (SELECT status='published' FROM public.cash_forecast_versions WHERE id=version_two);
  ASSERT (SELECT count(*)=1 FROM public.cash_forecast_versions v WHERE v.forecast_id=v_forecast_id AND v.case_type='base' AND v.status='published');

  PERFORM set_config('request.jwt.claim.sub',v_account_a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.cash_forecasts f WHERE f.id=v_forecast_id)=1;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',v_account_b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.cash_forecasts f WHERE f.id=v_forecast_id)=0;
  EXECUTE 'RESET ROLE';

  ASSERT (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.cash_forecasts f WHERE user_id=v_account_b) IS NOT DISTINCT FROM other_before;
  RAISE NOTICE 'PASS: forecast storage is account-scoped, publication is atomic, and published records are immutable.';
END $$;
ROLLBACK;
