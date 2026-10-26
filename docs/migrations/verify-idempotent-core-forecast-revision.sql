-- PREVIEW verification. Replace the two UUIDs with a dedicated account and
-- one of its currently published base forecast versions. The account must not
-- already have a draft.
DO $$
DECLARE
  v_account uuid := '00000000-0000-0000-0000-000000000000';
  v_published uuid := '00000000-0000-0000-0000-000000000000';
  v_first jsonb;
  v_second jsonb;
BEGIN
  IF current_user <> 'postgres' OR v_account='00000000-0000-0000-0000-000000000000'::uuid
     OR v_published='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Confirm PREVIEW and supply a dedicated account and published forecast UUID';
  END IF;

  v_first:=public.begin_core_forecast_revision(v_account,v_published,current_date,current_date,10000,5000);
  v_second:=public.begin_core_forecast_revision(v_account,v_published,current_date,current_date,10000,5000);

  ASSERT v_first->>'version_id'=v_second->>'version_id', 'Retry created or returned a different draft';
  ASSERT v_first->>'reused'='false', 'First request unexpectedly reused a draft';
  ASSERT v_second->>'reused'='true', 'Retry did not reuse the existing draft';
  ASSERT (SELECT count(*)=1 FROM public.cash_forecast_versions
    WHERE user_id=v_account AND status='draft' AND case_type='base'),
    'More than one base draft exists';

  RAISE NOTICE 'PASS: repeated Core revision requests return the same draft.';
  RAISE EXCEPTION 'ROLLBACK VERIFICATION';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'ROLLBACK VERIFICATION' THEN RAISE; END IF;
END $$;
