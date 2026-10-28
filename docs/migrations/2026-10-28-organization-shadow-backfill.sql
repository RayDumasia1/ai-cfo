-- ORG-01B OPERATIONAL BACKFILL. No fixtures or financial/billing mutations.
-- Run as postgres AFTER 2026-10-28-organization-shadow-storage.sql in the
-- intended production project. Rerun this file until status is COMPLETE.
-- Each successful run commits at most 100 new shadow organization graphs.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE p record; table_name text; operation_id uuid:=gen_random_uuid();
  processed integer:=0; result jsonb;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run operational backfill as postgres'; END IF;
  IF to_regprocedure('public.ensure_legacy_organization(uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('organization_private.assert_shadow_organization(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Install the reviewed ORG-01B expansion before backfill'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.business_profiles'::regclass
    AND NOT tgisinternal AND tgenabled='O' AND tgname IN ('organization_profile_identity','organization_profile_provisioned'))<>2 THEN
    RAISE EXCEPTION 'Required organization profile hooks are not enabled'; END IF;
  FOREACH table_name IN ARRAY ARRAY['organizations','organization_memberships','legacy_account_organizations','organization_access_events'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=table_name AND c.relkind='r' AND c.relrowsecurity)
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name)
      OR has_table_privilege('anon','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('service_role','public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR NOT has_table_privilege('service_role','public.'||table_name,'SELECT') THEN
      RAISE EXCEPTION 'Unexpected shadow table privileges or row security'; END IF;
  END LOOP;
  IF has_function_privilege('anon','public.ensure_legacy_organization(uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.ensure_legacy_organization(uuid,uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.ensure_legacy_organization(uuid,uuid,uuid)','EXECUTE')
    OR has_schema_privilege('anon','organization_private','USAGE')
    OR has_schema_privilege('authenticated','organization_private','USAGE')
    OR has_schema_privilege('service_role','organization_private','USAGE') THEN
    RAISE EXCEPTION 'Unexpected shadow routine privileges'; END IF;
  IF EXISTS(SELECT 1 FROM public.business_profiles b JOIN public.legacy_account_organizations l
    ON l.legacy_business_profile_id=b.id WHERE l.state<>'live'
    OR l.current_business_profile_id IS DISTINCT FROM b.id OR l.legacy_user_id IS DISTINCT FROM b.user_id) THEN
    RAISE EXCEPTION 'Legacy profile mapping conflict requires reviewed repair'; END IF;

  -- Read-only graph reconciliation before and after the operational batch.
  -- This invokes no fixture verifier and does not repair inconsistent history.
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
  FOR p IN
    SELECT b.id,b.user_id FROM public.business_profiles b
    WHERE NOT EXISTS(SELECT 1 FROM public.legacy_account_organizations l WHERE l.legacy_business_profile_id=b.id)
    ORDER BY b.id LIMIT 100 FOR UPDATE OF b
  LOOP
    result:=public.ensure_legacy_organization(p.id,p.user_id,operation_id);
    IF (result->>'created')::boolean THEN processed:=processed+1; END IF;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
  RAISE NOTICE 'ORG-01B operational batch provisioned % organization(s)',processed;
END $$;
COMMIT;

-- Deliberately return the summary AFTER COMMIT, so SQL Editor shows counts
-- for committed work. If a run is interrupted, rerunning is idempotent.
WITH totals AS (
  SELECT
    (SELECT count(*) FROM public.business_profiles) AS profiles,
    (SELECT count(*) FROM public.organizations WHERE lifecycle='active') AS active_organizations,
    (SELECT count(*) FROM public.organizations WHERE lifecycle='archived') AS archived_organizations,
    (SELECT count(*) FROM public.business_profiles b WHERE NOT EXISTS(
      SELECT 1 FROM public.legacy_account_organizations l WHERE l.legacy_business_profile_id=b.id)) AS unmapped_profiles,
    (SELECT count(*) FROM public.business_profiles b JOIN public.legacy_account_organizations l
      ON l.legacy_business_profile_id=b.id WHERE l.state<>'live' OR l.current_business_profile_id IS DISTINCT FROM b.id
      OR l.legacy_user_id IS DISTINCT FROM b.user_id) AS conflicting_mappings
)
SELECT CASE
  WHEN conflicting_mappings>0 OR active_organizations<>profiles-unmapped_profiles THEN 'REVIEW_REQUIRED'
  WHEN unmapped_profiles=0 THEN 'COMPLETE'
  ELSE 'RUN_NEXT_BATCH'
END AS status,profiles,active_organizations,archived_organizations,unmapped_profiles,conflicting_mappings
FROM totals;
