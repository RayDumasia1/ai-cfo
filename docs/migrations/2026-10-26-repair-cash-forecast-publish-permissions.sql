-- Apply in PREVIEW first. Restores the explicit service-role permission chain
-- used to publish a weekly cash plan. This migration is idempotent.
BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.cash_forecasts,
           public.cash_forecast_versions,
           public.cash_forecast_schedules,
           public.cash_forecast_items,
           public.cash_forecast_assumptions,
           public.cash_forecast_assumption_items
  TO service_role;

GRANT EXECUTE
  ON FUNCTION public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz),
              public.guard_cash_forecast_business_owner(),
              public.guard_cash_forecast_deletion(),
              public.guard_cash_forecast_version_immutability(),
              public.guard_cash_forecast_child_mutation(),
              public.touch_cash_forecast_draft()
  TO service_role;

COMMIT;
