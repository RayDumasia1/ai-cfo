-- PREVIEW ONLY. Session A of the FORECAST-01C concurrency check.
-- Replace the two zero UUID values in the declarations, set preview_confirmed=true,
-- run this, then immediately run session B in a second SQL editor.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean:=false;
  v_account_id uuid:='00000000-0000-0000-0000-000000000000'::uuid;
  v_business_id uuid:='00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed
     OR v_account_id='00000000-0000-0000-0000-000000000000'::uuid
     OR v_business_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply a dedicated account and its business profile UUID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_profiles b WHERE b.id=v_business_id AND b.user_id=v_account_id) THEN
    RAISE EXCEPTION 'Business profile does not belong to account';
  END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.begin_cash_forecast_draft(v_account_id,v_business_id,'USD','2026-10-25','2026-10-25',100000,0,25000,'concurrency-a','forecast-1','{"source":"concurrency-a"}',NULL);
  PERFORM pg_sleep(15);
  EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;

