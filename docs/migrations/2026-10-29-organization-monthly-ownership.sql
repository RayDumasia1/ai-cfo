-- ORG-01D2. Preview first. Storage/integrity expansion; no delegated authority.
-- One-time install. Preexisting financial fields and archived JSON stay unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.financial_months,public.expense_categories,public.data_imports,public.financial_data_revisions IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE name text; invalid_scope boolean;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run D2 as postgres'; END IF;
  IF to_regprocedure('public.read_owned_financial_months(uuid,integer)') IS NULL
    OR to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL
    OR to_regprocedure('public.clear_financial_data_preserving_settings(uuid)') IS NULL THEN
    RAISE EXCEPTION 'B/C and reviewed import/clear prerequisites required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.business_profiles'::regclass
    AND tgname='organization_profile_provisioned' AND tgfoid='organization_private.provision_inserted_profile()'::regprocedure AND tgenabled='O' AND tgtype=5) THEN
    RAISE EXCEPTION 'Enabled B profile provisioning required'; END IF;
  IF to_regclass('organization_private.financial_scopes') IS NOT NULL THEN RAISE EXCEPTION 'D2 already installed or partial installation'; END IF;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
  IF EXISTS(SELECT 1 FROM public.business_profiles p LEFT JOIN public.legacy_account_organizations l
    ON l.current_business_profile_id=p.id AND l.legacy_user_id=p.user_id AND l.state='live' WHERE l.organization_id IS NULL) THEN
    RAISE EXCEPTION 'Complete live B mapping required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.financial_months'::regclass
    AND tgname='trg_financial_months_updated_at' AND tgfoid='public.update_updated_at()'::regprocedure AND tgenabled='O' AND tgtype=19)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgrelid=ANY(ARRAY[
      'public.financial_months'::regclass,'public.expense_categories'::regclass,'public.data_imports'::regclass,'public.financial_data_revisions'::regclass])
      AND NOT(tgrelid='public.financial_months'::regclass AND tgname='trg_financial_months_updated_at')) THEN
    RAISE EXCEPTION 'Review unexpected monthly/import triggers'; END IF;
  FOREACH name IN ARRAY ARRAY['financial_months','expense_categories','data_imports','financial_data_revisions'] LOOP
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=('public.'||name)::regclass AND attname='organization_id' AND NOT attisdropped) THEN
      RAISE EXCEPTION 'Unexpected existing organization column'; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I t LEFT JOIN public.business_profiles p ON p.user_id=t.user_id WHERE p.id IS NULL)',name) INTO STRICT invalid_scope;
    IF invalid_scope THEN RAISE EXCEPTION 'Unmapped historical owner requires reviewed repair'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.financial_months t LEFT JOIN public.business_profiles p ON p.id=t.business_id
    WHERE t.business_id IS NULL OR p.id IS NULL OR p.user_id IS DISTINCT FROM t.user_id)
    OR EXISTS(SELECT 1 FROM public.expense_categories t LEFT JOIN public.business_profiles p ON p.id=t.business_id
    WHERE t.business_id IS NULL OR p.id IS NULL OR p.user_id IS DISTINCT FROM t.user_id) THEN
    RAISE EXCEPTION 'Monthly/category scope requires reviewed repair'; END IF;
END $$;

-- A stable, private compatibility identity. No Auth/profile FK: deletion must
-- retain ownership evidence while legacy business_id SET NULL keeps working.
CREATE TABLE organization_private.financial_scopes (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  legacy_business_profile_id uuid NOT NULL UNIQUE,
  legacy_user_id uuid NOT NULL,
  UNIQUE(organization_id,legacy_user_id),
  UNIQUE(organization_id,legacy_business_profile_id,legacy_user_id)
);
REVOKE ALL ON TABLE organization_private.financial_scopes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION organization_private.guard_financial_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'organization_private' OR TG_TABLE_NAME<>'financial_scopes' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Financial scope identity is immutable' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.legacy_account_organizations l JOIN public.business_profiles p
    ON p.id=l.current_business_profile_id AND p.user_id=l.legacy_user_id JOIN public.organizations o ON o.id=l.organization_id
    WHERE l.organization_id=NEW.organization_id AND l.legacy_business_profile_id=NEW.legacy_business_profile_id
      AND l.legacy_user_id=NEW.legacy_user_id AND l.state='live' AND o.lifecycle='active' AND o.kind='customer' AND o.access_mode='legacy_shadow') THEN
    RAISE EXCEPTION 'Verified live financial scope required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_scope_identity BEFORE INSERT OR UPDATE OR DELETE ON organization_private.financial_scopes
  FOR EACH ROW EXECUTE FUNCTION organization_private.guard_financial_scope();
INSERT INTO organization_private.financial_scopes SELECT l.organization_id,l.legacy_business_profile_id,l.legacy_user_id
  FROM public.legacy_account_organizations l WHERE l.state='live';

CREATE FUNCTION organization_private.provision_financial_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'business_profiles' OR TG_OP<>'INSERT' OR TG_WHEN<>'AFTER' THEN
    RAISE EXCEPTION 'Invalid financial scope provisioning context'; END IF;
  INSERT INTO organization_private.financial_scopes
    SELECT l.organization_id,l.legacy_business_profile_id,l.legacy_user_id FROM public.legacy_account_organizations l
    WHERE l.current_business_profile_id=NEW.id AND l.legacy_user_id=NEW.user_id AND l.state='live';
  IF NOT FOUND THEN RAISE EXCEPTION 'B provisioning must precede financial scope'; END IF;
  RETURN NULL;
END $$;
-- PostgreSQL executes same-kind triggers alphabetically, after B provisioning.
CREATE TRIGGER zz_organization_financial_scope AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION organization_private.provision_financial_scope();

CREATE TEMP TABLE d2_before(table_name text PRIMARY KEY,rows jsonb) ON COMMIT DROP;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['financial_months','expense_categories','data_imports','financial_data_revisions'] LOOP
    EXECUTE format('INSERT INTO d2_before SELECT %L,coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]''::jsonb) FROM public.%I t',name,name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id uuid',name);
  END LOOP;
END $$;
ALTER TABLE public.financial_months DISABLE TRIGGER trg_financial_months_updated_at;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['financial_months','expense_categories','data_imports','financial_data_revisions'] LOOP
    EXECUTE format('UPDATE public.%I t SET organization_id=s.organization_id FROM organization_private.financial_scopes s WHERE s.legacy_user_id=t.user_id',name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL',name);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(organization_id,user_id) REFERENCES organization_private.financial_scopes(organization_id,legacy_user_id)',name,name||'_organization_owner_fk');
    EXECUTE format('CREATE INDEX %I ON public.%I(organization_id)',name||'_organization_idx',name);
  END LOOP;
END $$;
ALTER TABLE public.financial_months ENABLE TRIGGER trg_financial_months_updated_at;
ALTER TABLE public.financial_months ADD CONSTRAINT financial_months_organization_profile_fk
  FOREIGN KEY(organization_id,business_id,user_id) REFERENCES organization_private.financial_scopes(organization_id,legacy_business_profile_id,legacy_user_id);
ALTER TABLE public.expense_categories ADD CONSTRAINT expense_categories_organization_profile_fk
  FOREIGN KEY(organization_id,business_id,user_id) REFERENCES organization_private.financial_scopes(organization_id,legacy_business_profile_id,legacy_user_id);

CREATE FUNCTION organization_private.guard_monthly_ownership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope organization_private.financial_scopes%ROWTYPE; profile_scoped boolean;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('financial_months','expense_categories','data_imports','financial_data_revisions')
    OR TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'Invalid ownership trigger context'; END IF;
  profile_scoped:=TG_TABLE_NAME IN ('financial_months','expense_categories');
  IF TG_OP='UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Financial organization/owner is immutable' USING ERRCODE='23514'; END IF;
    IF profile_scoped THEN
      IF NEW.business_id IS DISTINCT FROM OLD.business_id AND NOT(NEW.business_id IS NULL AND OLD.business_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM public.business_profiles WHERE id=OLD.business_id)) THEN
        RAISE EXCEPTION 'Financial profile is immutable except deletion detachment' USING ERRCODE='23514'; END IF;
      IF NEW.business_id IS NULL AND EXISTS(SELECT 1 FROM public.business_profiles WHERE id=OLD.business_id) THEN
        RAISE EXCEPTION 'Live financial profile required' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT s.* INTO scope FROM organization_private.financial_scopes s JOIN public.business_profiles p
    ON p.id=s.legacy_business_profile_id AND p.user_id=s.legacy_user_id JOIN public.legacy_account_organizations l
    ON l.organization_id=s.organization_id AND l.current_business_profile_id=p.id AND l.legacy_user_id=p.user_id AND l.state='live'
    JOIN public.organizations o ON o.id=s.organization_id AND o.lifecycle='active'
    WHERE s.legacy_user_id=NEW.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Live financial scope unavailable' USING ERRCODE='55000'; END IF;
  IF NEW.organization_id IS NOT NULL AND NEW.organization_id<>scope.organization_id THEN
    RAISE EXCEPTION 'Foreign financial organization' USING ERRCODE='23514'; END IF;
  IF profile_scoped THEN
    IF NEW.business_id IS NULL OR NEW.business_id<>scope.legacy_business_profile_id THEN
      RAISE EXCEPTION 'Foreign or missing financial profile' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='financial_data_revisions' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.months_snapshot||NEW.categories_snapshot) e(value)
      WHERE (e.value?'organization_id' AND e.value->>'organization_id' IS DISTINCT FROM scope.organization_id::text)
        OR (e.value?'user_id' AND e.value->>'user_id' IS DISTINCT FROM scope.legacy_user_id::text)
        OR (e.value?'business_id' AND e.value->>'business_id' IS NOT NULL AND e.value->>'business_id' IS DISTINCT FROM scope.legacy_business_profile_id::text)) THEN
      RAISE EXCEPTION 'Foreign revision snapshot scope' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.organization_id:=scope.organization_id;
  RETURN NEW;
END $$;
DO $$ DECLARE name text; after_rows jsonb; BEGIN
  FOREACH name IN ARRAY ARRAY['financial_months','expense_categories','data_imports','financial_data_revisions'] LOOP
    EXECUTE format('CREATE TRIGGER organization_monthly_ownership BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION organization_private.guard_monthly_ownership()',name);
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)-''organization_id'' ORDER BY t.id),''[]''::jsonb) FROM public.%I t',name) INTO after_rows;
    IF after_rows IS DISTINCT FROM (SELECT rows FROM d2_before WHERE table_name=name) THEN
      RAISE EXCEPTION 'Preexisting financial fields changed during expansion'; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION organization_private.guard_financial_scope(),organization_private.provision_financial_scope(),organization_private.guard_monthly_ownership()
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE organization_private.financial_scopes IS 'ORG-01D2 immutable legacy scope bridge. Internal integrity only, not a delegated authorization grant. Retained after Auth/profile deletion.';
COMMENT ON COLUMN public.financial_data_revisions.organization_id IS 'D2 revision-header ownership. Archived JSON remains unchanged; new complete-row snapshots may additionally contain organization_id under format_version 1.';
COMMIT;
