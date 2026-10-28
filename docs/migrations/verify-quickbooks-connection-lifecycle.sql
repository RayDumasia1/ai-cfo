-- PREVIEW ONLY. All fixture changes roll back. No Intuit calls or real tokens.
BEGIN;
DO $$
DECLARE a uuid:=nullif(current_setting('app.preview_account_a',true),'')::uuid;
  b uuid:=nullif(current_setting('app.preview_account_b',true),'')::uuid;
  business uuid; c jsonb; linked jsonb; revoked jsonb; original_version text; months bigint;
BEGIN
  IF current_setting('app.preview_confirmed',true) IS DISTINCT FROM 'true' OR a IS NULL OR b IS NULL OR a=b THEN
    RAISE EXCEPTION 'Dedicated preview accounts required'; END IF;
  SELECT id,data_version INTO business,original_version FROM public.business_profiles WHERE user_id=a;
  IF business IS NULL OR NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE user_id=a) THEN RAISE EXCEPTION 'Preview account setup missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.quickbooks_connections WHERE business_id=business) THEN RAISE EXCEPTION 'Use a preview account without an existing QuickBooks connection'; END IF;
  SELECT count(*) INTO months FROM public.financial_months WHERE user_id=a;
  UPDATE public.subscriptions SET feature_tier='core',status='active',plan='core' WHERE user_id=a;
  c:=public.quickbooks_lifecycle(a,business,'start',jsonb_build_object('stateHash',repeat('a',64),'browserHash',repeat('b',64)));
  BEGIN
    PERFORM public.quickbooks_lifecycle(b,business,'read'); RAISE EXCEPTION 'Cross-account lookup unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.quickbooks_lifecycle(a,business,'claim',jsonb_build_object('stateHash',repeat('a',64),'browserHash',repeat('c',64),'realmId','999999991234567890'));
    RAISE EXCEPTION 'Foreign browser unexpectedly claimed intent';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  c:=public.quickbooks_lifecycle(a,business,'claim',jsonb_build_object('stateHash',repeat('a',64),'browserHash',repeat('b',64),'realmId','999999991234567890'));
  BEGIN
    PERFORM public.quickbooks_lifecycle(a,business,'claim',jsonb_build_object('stateHash',repeat('a',64),'browserHash',repeat('b',64),'realmId','999999991234567890'));
    RAISE EXCEPTION 'Replay unexpectedly claimed intent';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM public.quickbooks_lifecycle(a,business,'store_grant',jsonb_build_object('generation',c->>'generation','operationId',c->>'operationId',
    'envelope',jsonb_build_object('version',1,'keyId','verifier','ciphertext','opaque-test-envelope'),
    'accessExpiresAt',clock_timestamp()+interval '1 hour','refreshExpiresAt',clock_timestamp()+interval '1 day'));
  linked:=public.quickbooks_lifecycle(a,business,'verify',jsonb_build_object('generation',c->>'generation','operationId',c->>'operationId','companyName','Rollback-only sandbox fixture'));
  IF linked->>'status'<>'connected' OR public.quickbooks_lifecycle(a,business,'read') ? 'envelope' THEN RAISE EXCEPTION 'Unsafe connection metadata'; END IF;
  c:=public.quickbooks_lifecycle(a,business,'refresh_claim');
  BEGIN
    PERFORM public.quickbooks_lifecycle(a,business,'refresh_claim'); RAISE EXCEPTION 'Concurrent refresh unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM public.quickbooks_lifecycle(a,business,'fail',jsonb_build_object('generation',c->>'generation','operationId',c->>'operationId'));
  UPDATE public.subscriptions SET feature_tier='starter',status='cancelled' WHERE user_id=a;
  revoked:=public.quickbooks_lifecycle(a,business,'disconnect_claim');
  IF revoked->>'generation'=linked->>'generation' OR revoked->>'credentialGeneration'<>linked->>'generation' OR revoked->>'status'<>'revoking' THEN RAISE EXCEPTION 'Disconnect did not fence access'; END IF;
  PERFORM public.quickbooks_lifecycle(a,business,'disconnect_fail',jsonb_build_object('generation',revoked->>'generation','operationId',revoked->>'operationId'));
  revoked:=public.quickbooks_lifecycle(a,business,'disconnect_claim');
  c:=public.quickbooks_lifecycle(a,business,'disconnect_finish',jsonb_build_object('generation',revoked->>'generation','operationId',revoked->>'operationId'));
  IF c->>'status'<>'disconnected' OR EXISTS(SELECT 1 FROM public.quickbooks_credentials WHERE connection_id=(c->>'id')::uuid) THEN RAISE EXCEPTION 'Revocation cleanup failed'; END IF;
  IF (SELECT count(*) FROM public.financial_months WHERE user_id=a)<>months OR
    (SELECT data_version FROM public.business_profiles WHERE id=business) IS DISTINCT FROM original_version THEN RAISE EXCEPTION 'Lifecycle changed financial data'; END IF;
  IF has_function_privilege('anon','public.quickbooks_lifecycle(uuid,uuid,text,jsonb)','EXECUTE') OR
    has_function_privilege('authenticated','public.quickbooks_lifecycle(uuid,uuid,text,jsonb)','EXECUTE') OR
    has_table_privilege('authenticated','public.quickbooks_credentials','SELECT') OR
    has_table_privilege('anon','public.quickbooks_connections','SELECT') THEN RAISE EXCEPTION 'Browser privileges leaked'; END IF;
  RAISE NOTICE 'PASS: OAuth replay/browser/workspace binding, refresh claim, downgrade disconnect, generation fence, encrypted recovery, privileges and unchanged financial data';
END $$;
ROLLBACK;
