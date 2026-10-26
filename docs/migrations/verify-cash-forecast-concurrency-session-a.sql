-- PREVIEW ONLY. Session A of the FORECAST-01C concurrency check.
-- Replace UUIDs, confirm preview, run this, then immediately run session B in a second SQL editor.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean:=false;
  account_a uuid:=NULL;
  business_a uuid:=NULL;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed OR account_a IS NULL OR business_a IS NULL THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply a dedicated account and its business profile UUID';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_profiles WHERE id=business_a AND user_id=account_a) THEN
    RAISE EXCEPTION 'Business profile does not belong to account';
  END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.begin_cash_forecast_draft(account_a,business_a,'USD','2026-10-25','2026-10-25',100000,0,25000,'concurrency-a','forecast-1','{"source":"concurrency-a"}',NULL);
  PERFORM pg_sleep(15);
  EXECUTE 'RESET ROLE';
END $$;
ROLLBACK;

