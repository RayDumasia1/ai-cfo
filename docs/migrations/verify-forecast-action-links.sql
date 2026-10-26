-- PREVIEW ONLY. Rolls back all fixtures. Replace zero UUIDs and confirm preview.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean:=false;
  v_account_id uuid:='00000000-0000-0000-0000-000000000000'::uuid;
  v_business_id uuid:='00000000-0000-0000-0000-000000000000'::uuid;
  v_draft jsonb; v_revision jsonb; v_forecast uuid; v_version uuid; v_revised uuid; v_updated timestamptz;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed
    OR v_account_id='00000000-0000-0000-0000-000000000000'::uuid
    OR v_business_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply an account and its business profile UUID';
  END IF;
  ASSERT (SELECT count(*)=2 FROM pg_constraint WHERE conrelid='public.actions'::regclass
    AND conname IN('actions_forecast_version_owner_fk','actions_forecast_item_owner_fk'));
  ASSERT has_function_privilege('service_role','public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.begin_core_forecast_revision(uuid,uuid,date,date,numeric,numeric)','EXECUTE');
  EXECUTE 'SET LOCAL ROLE service_role';
  v_draft:=public.begin_cash_forecast_draft(v_account_id,v_business_id,'USD','2026-10-25','2026-10-25',100000,0,25000,'01d-verify','forecast-1','{"source":"verification"}',NULL);
  v_forecast:=(v_draft->>'forecast_id')::uuid; v_version:=(v_draft->>'version_id')::uuid;
  INSERT INTO public.cash_forecast_items(version_id,user_id,item_key,description,amount,direction,category,expected_date,status,confidence,source_type,source_updated_at,created_by,updated_by)
    VALUES(v_version,v_account_id,'01d-item','Customer payment',10000,'inflow','customer_receipt','2026-10-30','expected','high','manual',now(),v_account_id,v_account_id);
  SELECT updated_at INTO v_updated FROM public.cash_forecast_versions WHERE id=v_version;
  PERFORM public.publish_cash_forecast_version(v_account_id,v_forecast,v_version,'{"valid":true,"weeks":[]}',v_updated);
  v_revision:=public.begin_core_forecast_revision(v_account_id,v_version,'2026-11-01','2026-11-01',110000,25000);
  v_revised:=(v_revision->>'version_id')::uuid;
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT parent_version_id=v_version AND status='draft' FROM public.cash_forecast_versions WHERE id=v_revised);
  ASSERT (SELECT count(*)=1 FROM public.cash_forecast_items WHERE version_id=v_revised AND item_key='01d-item');
  RAISE NOTICE 'PASS: forecast action ownership constraints and atomic Core revision are installed.';
END $$;
ROLLBACK;
