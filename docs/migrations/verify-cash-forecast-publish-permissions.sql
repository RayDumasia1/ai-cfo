-- Read-only verification for the weekly cash-plan publish permission chain.
DO $$
BEGIN
  ASSERT has_schema_privilege('service_role','public','USAGE'),
    'service_role requires USAGE on public';

  ASSERT has_table_privilege('service_role','public.cash_forecasts','SELECT,UPDATE'),
    'service_role requires SELECT and UPDATE on cash_forecasts';
  ASSERT has_table_privilege('service_role','public.cash_forecast_versions','SELECT,UPDATE'),
    'service_role requires SELECT and UPDATE on cash_forecast_versions';
  ASSERT has_table_privilege('service_role','public.cash_forecast_items','SELECT'),
    'service_role requires SELECT on cash_forecast_items';

  ASSERT has_function_privilege(
    'service_role',
    'public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz)',
    'EXECUTE'
  ), 'service_role requires EXECUTE on publish_cash_forecast_version';
  ASSERT NOT has_function_privilege(
    'authenticated',
    'public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz)',
    'EXECUTE'
  ), 'authenticated must not execute publish_cash_forecast_version';
  ASSERT NOT has_function_privilege(
    'anon',
    'public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz)',
    'EXECUTE'
  ), 'anon must not execute publish_cash_forecast_version';
END $$;

SELECT 'PASS: weekly cash-plan publish permissions are correctly restricted.' AS result;
