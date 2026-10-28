-- PREVIEW ONLY. Disposable identities and all changes roll back. Never production.
BEGIN;
DO $$
DECLARE u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); p uuid; initial jsonb; replay jsonb; before_state jsonb;
  m uuid; name text; count_before bigint;
  payload jsonb:='[{"month_date":"2099-01-01","notes":"shadow verifier","data_contract_version":2,"source_type":"spreadsheet","accounting_basis":"cash","reporting_currency":"USD","period_status":"complete","period_cutoff_date":null,"opening_included_cash":100,"closing_included_cash":110,"closing_unavailable_cash":0,"cash_collected_from_customers":20,"operating_cash_paid":10,"owner_draws_paid":0,"debt_principal_paid":0,"debt_interest_paid":0,"investing_cash_paid":0,"investing_cash_received":0,"debt_funding_received":0,"owner_funding_received":0,"other_cash_inflows":0,"other_cash_outflows":0}]';
BEGIN
  IF current_user<>'postgres' OR current_setting('app.preview_confirmed',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Confirmed preview operator required'; END IF;
  INSERT INTO auth.users(id) VALUES(u),(v);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.business_profiles(user_id,business_name) VALUES(u,'Rollback-only shadow fixture') RETURNING id INTO p;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','',true);
  initial:=public.ensure_legacy_organization(p,u,gen_random_uuid());
  IF (initial->>'created')::boolean THEN RAISE EXCEPTION 'Profile insert did not provision atomically'; END IF;
  SELECT jsonb_build_object('profile',to_jsonb(b),'org',to_jsonb(o),'member',to_jsonb(s),'mapping',to_jsonb(l),'event',to_jsonb(e)) INTO before_state
    FROM public.business_profiles b JOIN public.legacy_account_organizations l ON l.current_business_profile_id=b.id
    JOIN public.organizations o ON o.id=l.organization_id JOIN public.organization_memberships s ON s.organization_id=o.id
    JOIN public.organization_access_events e ON e.organization_id=o.id WHERE b.id=p;
  replay:=public.ensure_legacy_organization(p,u,gen_random_uuid());
  IF replay<>initial OR NOT EXISTS(SELECT 1 FROM public.business_profiles b JOIN public.legacy_account_organizations l ON l.current_business_profile_id=b.id
    JOIN public.organizations o ON o.id=l.organization_id JOIN public.organization_memberships s ON s.organization_id=o.id
    JOIN public.organization_access_events e ON e.organization_id=o.id WHERE b.id=p
    AND jsonb_build_object('profile',to_jsonb(b),'org',to_jsonb(o),'member',to_jsonb(s),'mapping',to_jsonb(l),'event',to_jsonb(e))=before_state) THEN
    RAISE EXCEPTION 'Exact replay mutated state'; END IF;
  BEGIN PERFORM public.ensure_legacy_organization(p,v,gen_random_uuid()); RAISE EXCEPTION 'Foreign owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM public.ensure_legacy_organization(p,u,gen_random_uuid());
    RAISE EXCEPTION 'Browser provisioning allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role'; UPDATE public.organizations SET display_name='forbidden';
    RAISE EXCEPTION 'Direct service mutation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH name IN ARRAY ARRAY['organizations','organization_memberships','legacy_account_organizations','organization_access_events'] LOOP
    IF has_table_privilege('anon','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated','public.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('service_role','public.'||name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Shadow privilege leak'; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: real authenticated profile hook, service-only wrapper, exact replay, ownership and least privilege';
  -- Existing UPDATE/upsert paths retain metadata; no new mapping/event on routine saves.
  SELECT count(*) INTO count_before FROM public.organization_access_events;
  UPDATE public.business_profiles SET business_name='Changed fixture name',onboarding_completed_at=now() WHERE id=p;
  INSERT INTO public.business_profiles(user_id) VALUES(u) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id;
  IF (SELECT count(*) FROM public.organization_access_events)<>count_before THEN RAISE EXCEPTION 'Routine save reprovisioned'; END IF;
  -- Allowed profile deletion archives identity; the Auth identity still exists here.
  DELETE FROM public.business_profiles WHERE id=p;
  PERFORM organization_private.assert_shadow_organization((initial->>'organization_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=(initial->>'organization_id')::uuid AND lifecycle='archived') THEN RAISE EXCEPTION 'Profile delete not archived'; END IF;
  BEGIN INSERT INTO public.business_profiles(id,user_id) VALUES(p,u); RAISE EXCEPTION 'Historical profile ID reused'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  INSERT INTO public.business_profiles(user_id) VALUES(u) RETURNING id INTO p;
  DELETE FROM auth.users WHERE id=u;
  IF EXISTS(SELECT 1 FROM public.organization_memberships WHERE legacy_subject_user_id=u AND (status<>'revoked' OR user_id IS NOT NULL)) THEN RAISE EXCEPTION 'Auth tombstone failed'; END IF;
  RAISE NOTICE 'PASS: profile/Auth deletion archives and tombstones; historical IDs cannot regain old identity';
  -- Exercise every current financial profile-creation path using fresh disposable identities.
  FOR name IN SELECT unnest(ARRAY['legacy_import','v2_import','review_comparison','review_confirmation','clear']) LOOP
    u:=gen_random_uuid(); INSERT INTO auth.users(id) VALUES(u);
    IF name='legacy_import' THEN PERFORM public.import_financial_data(u,'[{"month_date":"2099-01-01","opening_cash":100,"closing_cash":110,"total_revenue":20,"total_expenses":10}]','{}','org-fixture.csv','update_months');
    ELSIF name='v2_import' THEN PERFORM public.import_financial_data_v2(u,payload,'{}','org-fixture.xlsx','update_months');
    ELSIF name='review_comparison' THEN PERFORM public.financial_import_v2_is_unchanged(u,payload,'{}','update_months');
    ELSIF name='review_confirmation' THEN
      -- Empty-state review establishes its own trusted profile, as the real review endpoint does.
      before_state:=public.financial_import_review_state(u);
      PERFORM public.import_reviewed_financial_data(u,payload,'{}','org-fixture.xlsx','update_months',before_state->>'state_version');
    ELSE PERFORM public.clear_financial_data_preserving_settings(u); END IF;
    SELECT id INTO STRICT p FROM public.business_profiles WHERE user_id=u;
    replay:=public.ensure_legacy_organization(p,u,gen_random_uuid());
    IF (replay->>'created')::boolean THEN RAISE EXCEPTION 'Financial creation path missed hook'; END IF;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE 'PASS: legacy/v2 import, unchanged review, reviewed confirmation and Clear Data create valid shadow identity';
END $$;
ROLLBACK;
