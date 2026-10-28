-- ORG-01B. PREVIEW FIRST. Internal identity only; no financial/billing conversion.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run expansion as postgres'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.business_profiles'::regclass AND attname='id' AND atttypid='uuid'::regtype AND attnotnull)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.business_profiles'::regclass AND attname='user_id' AND atttypid='uuid'::regtype AND attnotnull)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.business_profiles'::regclass AND attname='business_name' AND atttypid='text'::regtype)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.business_profiles'::regclass AND contype='u' AND convalidated AND pg_catalog.pg_get_constraintdef(oid)='UNIQUE (user_id)')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.business_profiles'::regclass AND confrelid='auth.users'::regclass AND contype='f' AND convalidated AND pg_catalog.pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE') THEN
    RAISE EXCEPTION 'Unexpected business profile ownership catalog'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.business_profiles'::regclass AND NOT tgisinternal AND tgname='trg_business_profiles_updated_at'
    AND tgfoid='public.update_updated_at()'::regprocedure AND tgtype=19 AND tgenabled='O')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND
      (tgrelid='auth.users'::regclass OR (tgrelid='public.business_profiles'::regclass AND tgname<>'trg_business_profiles_updated_at'))) THEN
    RAISE EXCEPTION 'Review unexpected profile or Auth triggers before expansion'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='business_profiles')<>1
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.business_profiles'::regclass)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='business_profiles' AND policyname='business_profiles: own rows'
    AND cmd='ALL' AND roles=ARRAY['authenticated']::name[] AND qual='(auth.uid() = user_id)' AND with_check='(auth.uid() = user_id)') THEN
    RAISE EXCEPTION 'Unexpected business profile RLS baseline'; END IF;
END $$;

CREATE SCHEMA organization_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA organization_private FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'customer' CHECK(kind='customer'),
  access_mode text NOT NULL DEFAULT 'legacy_shadow' CHECK(access_mode='legacy_shadow'),
  lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','archived')),
  display_name text,
  display_name_source text NOT NULL DEFAULT 'legacy_profile_snapshot' CHECK(display_name_source='legacy_profile_snapshot'),
  access_revision bigint NOT NULL DEFAULT 1 CHECK(access_revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  CHECK((lifecycle='archived')=(archived_at IS NOT NULL))
);
CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  legacy_subject_user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK(role='owner'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  origin text NOT NULL DEFAULT 'legacy_profile_owner' CHECK(origin='legacy_profile_owner'),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  UNIQUE(organization_id,user_id),
  CHECK(user_id IS NULL OR user_id=legacy_subject_user_id),
  CHECK(status<>'active' OR user_id IS NOT NULL),
  CHECK((status='revoked')=(revoked_at IS NOT NULL))
);
CREATE TABLE public.legacy_account_organizations (
  legacy_business_profile_id uuid PRIMARY KEY,
  current_business_profile_id uuid UNIQUE REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  legacy_user_id uuid NOT NULL,
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'live' CHECK(state IN ('live','detached')),
  provisioning_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detached_at timestamptz,
  CHECK(current_business_profile_id IS NULL OR current_business_profile_id=legacy_business_profile_id),
  CHECK((state='live')=(current_business_profile_id IS NOT NULL)),
  CHECK((state='detached')=(detached_at IS NOT NULL))
);
CREATE UNIQUE INDEX legacy_organizations_one_live_account ON public.legacy_account_organizations(legacy_user_id) WHERE state='live';
CREATE TABLE public.organization_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('legacy_organization_provisioned','legacy_profile_detached')),
  operation_id uuid NOT NULL,
  policy_version text NOT NULL DEFAULT 'org-shadow-1' CHECK(policy_version='org-shadow-1'),
  actor_kind text NOT NULL DEFAULT 'system' CHECK(actor_kind='system'),
  actor_reference uuid CHECK(actor_reference IS NULL),
  subject_user_reference uuid NOT NULL,
  business_profile_reference uuid NOT NULL,
  membership_reference uuid NOT NULL,
  origin text NOT NULL CHECK(origin IN ('profile_insert','service_ensure','profile_detach')),
  resulting_access_revision bigint NOT NULL CHECK(resulting_access_revision>0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,event_type),
  CHECK((event_type='legacy_profile_detached')=(origin='profile_detach'))
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_account_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations,public.organization_memberships,public.legacy_account_organizations,public.organization_access_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.organizations,public.organization_memberships,public.legacy_account_organizations,public.organization_access_events TO service_role;

CREATE FUNCTION organization_private.assert_shadow_organization(p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.organizations%ROWTYPE; m public.organization_memberships%ROWTYPE;
  l public.legacy_account_organizations%ROWTYPE; e public.organization_access_events%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shadow organization missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO l FROM public.legacy_account_organizations WHERE organization_id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shadow mapping missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO m FROM public.organization_memberships WHERE organization_id=p_id;
  IF NOT FOUND OR m.legacy_subject_user_id<>l.legacy_user_id THEN RAISE EXCEPTION 'Shadow owner mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO e FROM public.organization_access_events WHERE organization_id=p_id AND event_type='legacy_organization_provisioned';
  IF NOT FOUND OR e.operation_id<>l.provisioning_operation_id OR e.subject_user_reference<>l.legacy_user_id
    OR e.business_profile_reference<>l.legacy_business_profile_id OR e.membership_reference<>m.id OR e.resulting_access_revision<>1 THEN
    RAISE EXCEPTION 'Shadow provisioning event mismatch' USING ERRCODE='23514'; END IF;
  IF o.lifecycle='active' THEN
    IF o.access_revision<>1 OR l.state<>'live' OR m.status<>'active' OR m.user_id IS DISTINCT FROM l.legacy_user_id
      OR NOT EXISTS(SELECT 1 FROM public.business_profiles WHERE id=l.current_business_profile_id AND user_id=l.legacy_user_id)
      OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=m.user_id)
      OR EXISTS(SELECT 1 FROM public.organization_access_events WHERE organization_id=p_id AND event_type='legacy_profile_detached') THEN
      RAISE EXCEPTION 'Invalid active shadow graph' USING ERRCODE='23514'; END IF;
  ELSE
    IF o.access_revision<>2 OR l.state<>'detached' OR m.status<>'revoked' THEN
      RAISE EXCEPTION 'Invalid archived shadow graph' USING ERRCODE='23514'; END IF;
    SELECT * INTO e FROM public.organization_access_events WHERE organization_id=p_id AND event_type='legacy_profile_detached';
    IF NOT FOUND OR e.subject_user_reference<>l.legacy_user_id OR e.business_profile_reference<>l.legacy_business_profile_id
      OR e.membership_reference<>m.id OR e.resulting_access_revision<>o.access_revision THEN
      RAISE EXCEPTION 'Shadow detachment event mismatch' USING ERRCODE='23514'; END IF;
  END IF;
END $$;

CREATE FUNCTION organization_private.enforce_shadow_graph() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'Invalid shadow trigger context'; END IF;
  IF TG_TABLE_NAME='organizations' THEN PERFORM organization_private.assert_shadow_organization(NEW.id);
  ELSIF TG_TABLE_NAME IN ('organization_memberships','legacy_account_organizations','organization_access_events') THEN
    PERFORM organization_private.assert_shadow_organization(NEW.organization_id);
  ELSE RAISE EXCEPTION 'Invalid shadow trigger context'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organizations_graph AFTER INSERT OR UPDATE ON public.organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_private.enforce_shadow_graph();
CREATE CONSTRAINT TRIGGER memberships_graph AFTER INSERT OR UPDATE ON public.organization_memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_private.enforce_shadow_graph();
CREATE CONSTRAINT TRIGGER legacy_mapping_graph AFTER INSERT OR UPDATE ON public.legacy_account_organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_private.enforce_shadow_graph();
CREATE CONSTRAINT TRIGGER organization_events_graph AFTER INSERT OR UPDATE ON public.organization_access_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_private.enforce_shadow_graph();

CREATE FUNCTION organization_private.guard_shadow_mutation() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Shadow identity/history cannot be deleted or rewritten' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='legacy_account_organizations' THEN
    IF OLD.current_business_profile_id IS NULL OR NEW.current_business_profile_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.business_profiles WHERE id=OLD.current_business_profile_id)
      OR (to_jsonb(NEW)-ARRAY['current_business_profile_id','state','detached_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['current_business_profile_id','state','detached_at']) THEN
      RAISE EXCEPTION 'Shadow mapping is immutable except profile detachment' USING ERRCODE='55000'; END IF;
    NEW.state:='detached'; NEW.detached_at:=clock_timestamp();
  ELSIF TG_TABLE_NAME='organizations' THEN
    IF OLD.lifecycle<>'active' OR NEW.lifecycle<>'archived'
      OR NOT EXISTS(SELECT 1 FROM public.legacy_account_organizations WHERE organization_id=OLD.id AND state='detached')
      OR (to_jsonb(NEW)-ARRAY['lifecycle','access_revision','updated_at','archived_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['lifecycle','access_revision','updated_at','archived_at']) THEN
      RAISE EXCEPTION 'Shadow organization is immutable except detachment' USING ERRCODE='55000'; END IF;
    NEW.access_revision:=OLD.access_revision+1; NEW.updated_at:=clock_timestamp(); NEW.archived_at:=clock_timestamp();
  ELSIF TG_TABLE_NAME='organization_memberships' THEN
    IF (to_jsonb(NEW)-ARRAY['user_id','status','revision','updated_at','revoked_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['user_id','status','revision','updated_at','revoked_at'])
      OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND (NEW.user_id IS NOT NULL OR OLD.user_id IS NULL
        OR EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id)))
      OR NEW.status NOT IN (OLD.status,'revoked')
      OR (NEW.user_id IS NOT DISTINCT FROM OLD.user_id AND NEW.status=OLD.status)
      OR (EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.legacy_subject_user_id)
        AND NOT EXISTS(SELECT 1 FROM public.legacy_account_organizations WHERE organization_id=OLD.organization_id AND state='detached')) THEN
      RAISE EXCEPTION 'Shadow membership cannot be regranted or rewritten' USING ERRCODE='55000'; END IF;
    NEW.status:='revoked'; NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp();
    NEW.revoked_at:=coalesce(OLD.revoked_at,clock_timestamp());
  ELSE RAISE EXCEPTION 'Shadow identity/history cannot be deleted or rewritten' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizations_guard BEFORE UPDATE OR DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION organization_private.guard_shadow_mutation();
CREATE TRIGGER memberships_guard BEFORE UPDATE OR DELETE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION organization_private.guard_shadow_mutation();
CREATE TRIGGER legacy_mapping_guard BEFORE UPDATE OR DELETE ON public.legacy_account_organizations FOR EACH ROW EXECUTE FUNCTION organization_private.guard_shadow_mutation();
CREATE TRIGGER organization_events_immutable BEFORE UPDATE OR DELETE ON public.organization_access_events FOR EACH ROW EXECUTE FUNCTION organization_private.guard_shadow_mutation();

CREATE FUNCTION organization_private.archive_detached_profile() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE member_id uuid; next_revision bigint;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'legacy_account_organizations' OR TG_OP<>'UPDATE'
    OR OLD.state<>'live' OR NEW.state<>'detached' THEN RAISE EXCEPTION 'Invalid detachment context'; END IF;
  UPDATE public.organizations SET lifecycle='archived' WHERE id=NEW.organization_id RETURNING access_revision INTO next_revision;
  UPDATE public.organization_memberships SET status='revoked' WHERE organization_id=NEW.organization_id AND status='active';
  SELECT id INTO STRICT member_id FROM public.organization_memberships WHERE organization_id=NEW.organization_id;
  INSERT INTO public.organization_access_events(organization_id,event_type,operation_id,subject_user_reference,business_profile_reference,membership_reference,origin,resulting_access_revision)
    VALUES(NEW.organization_id,'legacy_profile_detached',gen_random_uuid(),NEW.legacy_user_id,NEW.legacy_business_profile_id,member_id,'profile_detach',next_revision);
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_mapping_detached AFTER UPDATE ON public.legacy_account_organizations
  FOR EACH ROW EXECUTE FUNCTION organization_private.archive_detached_profile();

CREATE FUNCTION organization_private.ensure_legacy_organization(p_profile uuid,p_expected_user uuid,p_operation uuid,p_origin text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE profile public.business_profiles%ROWTYPE; mapping public.legacy_account_organizations%ROWTYPE;
  org_id uuid; member_id uuid; created boolean:=false;
BEGIN
  IF p_profile IS NULL OR p_expected_user IS NULL OR p_operation IS NULL OR p_origin IS NULL OR p_origin NOT IN ('profile_insert','service_ensure') THEN
    RAISE EXCEPTION 'Invalid shadow provisioning request' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Shadow provisioning requires READ COMMITTED' USING ERRCODE='0A000'; END IF;
  SELECT * INTO profile FROM public.business_profiles WHERE id=p_profile FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Legacy profile missing' USING ERRCODE='P0002'; END IF;
  IF profile.user_id<>p_expected_user THEN RAISE EXCEPTION 'Legacy profile owner mismatch' USING ERRCODE='42501'; END IF;
  SELECT * INTO mapping FROM public.legacy_account_organizations WHERE legacy_business_profile_id=p_profile;
  IF FOUND THEN
    IF mapping.state<>'live' OR mapping.legacy_user_id<>p_expected_user THEN RAISE EXCEPTION 'Legacy mapping conflict' USING ERRCODE='55000'; END IF;
    PERFORM organization_private.assert_shadow_organization(mapping.organization_id);
    SELECT id INTO STRICT member_id FROM public.organization_memberships WHERE organization_id=mapping.organization_id;
    org_id:=mapping.organization_id;
  ELSE
    INSERT INTO public.organizations(display_name) VALUES(profile.business_name) RETURNING id INTO org_id;
    INSERT INTO public.organization_memberships(organization_id,user_id,legacy_subject_user_id) VALUES(org_id,profile.user_id,profile.user_id) RETURNING id INTO member_id;
    INSERT INTO public.legacy_account_organizations(legacy_business_profile_id,current_business_profile_id,legacy_user_id,organization_id,provisioning_operation_id)
      VALUES(profile.id,profile.id,profile.user_id,org_id,p_operation) RETURNING * INTO mapping;
    INSERT INTO public.organization_access_events(organization_id,event_type,operation_id,subject_user_reference,business_profile_reference,membership_reference,origin,resulting_access_revision)
      VALUES(org_id,'legacy_organization_provisioned',p_operation,profile.user_id,profile.id,member_id,p_origin,1);
    PERFORM organization_private.assert_shadow_organization(org_id); created:=true;
  END IF;
  RETURN jsonb_build_object('organization_id',org_id,'membership_id',member_id,'business_profile_id',profile.id,
    'provisioning_operation_id',mapping.provisioning_operation_id,'created',created);
END $$;
CREATE FUNCTION public.ensure_legacy_organization(p_business_profile_id uuid,p_expected_user_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT organization_private.ensure_legacy_organization(p_business_profile_id,p_expected_user_id,p_operation_id,'service_ensure');
$$;
CREATE FUNCTION organization_private.provision_inserted_profile() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'business_profiles' OR TG_OP<>'INSERT' OR TG_WHEN<>'AFTER' THEN
    RAISE EXCEPTION 'Invalid profile provisioning context'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Profile actor mismatch' USING ERRCODE='42501'; END IF;
  PERFORM organization_private.ensure_legacy_organization(NEW.id,NEW.user_id,gen_random_uuid(),'profile_insert');
  RETURN NEW;
END $$;
CREATE FUNCTION organization_private.guard_profile_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Legacy profile identity cannot be reassigned' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_profile_provisioned AFTER INSERT ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION organization_private.provision_inserted_profile();
CREATE TRIGGER organization_profile_identity BEFORE UPDATE OF id,user_id ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION organization_private.guard_profile_identity();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA organization_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ensure_legacy_organization(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ensure_legacy_organization(uuid,uuid,uuid) TO service_role;
COMMENT ON TABLE public.organizations IS 'ORG-01B internal legacy shadow only. No customer authorization, billing or collaboration activation.';
COMMENT ON FUNCTION public.ensure_legacy_organization(uuid,uuid,uuid) IS 'Service-only fixed owner provisioning; profile lock, complete-graph validation and exact replay. No financial/profile/billing updates.';
COMMIT;
