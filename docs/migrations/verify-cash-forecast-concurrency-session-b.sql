-- PREVIEW ONLY. Start while session A is sleeping. All changes roll back.
BEGIN;
DO $$
DECLARE
  preview_confirmed boolean:=false;
  account_a uuid:=NULL;
  business_a uuid:=NULL;
  started_at timestamptz;
  elapsed interval;
  result jsonb;
BEGIN
  IF current_user<>'postgres' OR NOT preview_confirmed OR account_a IS NULL OR business_a IS NULL THEN
    RAISE EXCEPTION 'Confirm PREVIEW and use the same account and business profile UUIDs as session A';
  END IF;
  started_at:=clock_timestamp();
  EXECUTE 'SET LOCAL ROLE service_role';
  result:=public.begin_cash_forecast_draft(account_a,business_a,'USD','2026-10-25','2026-10-25',100000,0,25000,'concurrency-b','forecast-1','{"source":"concurrency-b"}',NULL);
  EXECUTE 'RESET ROLE';
  elapsed:=clock_timestamp()-started_at;
  ASSERT elapsed >= interval '5 seconds', 'Session B did not wait for the account forecast lock';
  ASSERT result->>'status'='draft';
  RAISE NOTICE 'PASS: concurrent draft creation serialized on the account lock (% elapsed).',elapsed;
END $$;
ROLLBACK;
