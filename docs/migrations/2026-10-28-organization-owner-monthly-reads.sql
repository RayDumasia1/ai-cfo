-- ORG-01C. Preview first. Read-only owner bridge; no financial/backfill mutations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Run owner-read migration as postgres'; END IF;
  IF to_regprocedure('public.ensure_legacy_organization(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'ORG-01B required'; END IF;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
  IF EXISTS(SELECT 1 FROM public.business_profiles p LEFT JOIN public.legacy_account_organizations l ON l.current_business_profile_id=p.id
    WHERE l.organization_id IS NULL OR l.state<>'live' OR l.legacy_user_id<>p.user_id) THEN RAISE EXCEPTION 'Complete B mapping required'; END IF;
  IF EXISTS(SELECT 1 FROM public.financial_months f LEFT JOIN public.business_profiles p ON p.id=f.business_id
    WHERE f.business_id IS NULL OR p.id IS NULL OR p.user_id IS DISTINCT FROM f.user_id) THEN RAISE EXCEPTION 'Monthly ownership scope requires reviewed repair'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='financial_months')<>1
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='financial_months'
      AND policyname='financial_months: own rows' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[]
      AND qual='(auth.uid() = user_id)' AND with_check='(auth.uid() = user_id)')
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.financial_months'::regclass)
    OR has_table_privilege('authenticated','public.financial_months','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Unexpected monthly RLS or write privileges'; END IF;
END $$;

CREATE FUNCTION organization_private.resolve_owner_read(p_actor uuid,p_organization uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE profile public.business_profiles%ROWTYPE; mapping public.legacy_account_organizations%ROWTYPE;
  org public.organizations%ROWTYPE; member public.organization_memberships%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Verified owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO profile FROM public.business_profiles WHERE user_id=p_actor;
  IF NOT FOUND THEN
    IF p_organization IS NOT NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
    RETURN NULL;
  END IF;
  SELECT * INTO mapping FROM public.legacy_account_organizations WHERE current_business_profile_id=profile.id
    AND legacy_user_id=p_actor AND state='live';
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace identity unavailable' USING ERRCODE='55000'; END IF;
  IF p_organization IS NOT NULL AND p_organization<>mapping.organization_id THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=mapping.organization_id;
  SELECT * INTO member FROM public.organization_memberships WHERE organization_id=mapping.organization_id AND user_id=p_actor
    AND legacy_subject_user_id=p_actor AND status='active' AND role='owner' AND origin='legacy_profile_owner';
  IF org.id IS NULL OR org.kind<>'customer' OR org.access_mode<>'legacy_shadow' OR org.lifecycle<>'active' OR member.id IS NULL THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('actorId',p_actor,'organizationId',org.id,'businessProfileId',profile.id,'membershipId',member.id,
    'accessRevision',org.access_revision,'membershipRevision',member.revision,'dataVersion',profile.data_version,'businessName',profile.business_name);
END $$;
CREATE FUNCTION organization_private.owner_monthly_entitlement(p_actor uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT feature_tier::text FROM public.subscriptions WHERE user_id=p_actor AND status IN ('active','pending_cancellation')
    AND (stripe_subscription_id IS NOT NULL OR plan<>'starter') AND feature_tier IN ('starter','core','growth','advisory');
$$;
CREATE FUNCTION public.can_read_owned_financial_month(p_business_id uuid,p_legacy_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_legacy_user_id OR p_business_id IS NULL THEN RETURN false; END IF;
  BEGIN context:=organization_private.resolve_owner_read(actor,NULL);
    EXCEPTION WHEN insufficient_privilege OR no_data_found OR object_not_in_prerequisite_state THEN RETURN false; END;
  RETURN context IS NOT NULL AND (context->>'businessProfileId')::uuid=p_business_id
    AND organization_private.owner_monthly_entitlement(actor) IS NOT NULL;
END $$;
CREATE FUNCTION public.list_owned_organizations() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
  context:=organization_private.resolve_owner_read(auth.uid(),NULL);
  IF context IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN jsonb_build_array(jsonb_build_object('id',context->>'organizationId','businessName',context->'businessName'));
END $$;
CREATE FUNCTION public.read_owned_financial_months(p_organization_id uuid DEFAULT NULL,p_limit integer DEFAULT 12) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; tier text; months jsonb; actor uuid:=auth.uid(); profile_id uuid;
BEGIN
  IF p_limit IS NOT NULL AND (p_limit<1 OR p_limit>240) THEN RAISE EXCEPTION 'Unsupported monthly read limit' USING ERRCODE='22023'; END IF;
  context:=organization_private.resolve_owner_read(actor,p_organization_id);
  IF context IS NULL THEN RETURN jsonb_build_object('state','profile_missing','context',NULL,'months','[]'::jsonb); END IF;
  -- Resolver proved actor = selected workspace's original legacy account owner.
  tier:=organization_private.owner_monthly_entitlement((context->>'actorId')::uuid);
  IF tier IS NULL THEN RETURN jsonb_build_object('state','subscription_required','context',NULL,'months','[]'::jsonb); END IF;
  profile_id:=(context->>'businessProfileId')::uuid;
  IF EXISTS(SELECT 1 FROM public.financial_months WHERE user_id=actor AND business_id IS DISTINCT FROM profile_id) THEN
    RAISE EXCEPTION 'Monthly ownership evidence unavailable' USING ERRCODE='55000'; END IF;
  IF p_limit IS NULL AND (SELECT count(*) FROM public.financial_months WHERE user_id=actor AND business_id=profile_id)>240 THEN
    RAISE EXCEPTION 'Monthly history exceeds supported read size' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.month_date DESC),'[]'::jsonb) INTO months FROM (
    SELECT * FROM public.financial_months WHERE user_id=actor AND business_id=profile_id ORDER BY month_date DESC LIMIT coalesce(p_limit,240)
  ) f;
  RETURN jsonb_build_object('state','ready','context',context||jsonb_build_object('capability','financial.months.read',
    'policyVersion','org-owner-read-1','entitlementTier',tier,'entitlementSource','legacy_subscription'),'months',months);
END $$;

REVOKE ALL ON FUNCTION organization_private.resolve_owner_read(uuid,uuid),organization_private.owner_monthly_entitlement(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.can_read_owned_financial_month(uuid,uuid),public.list_owned_organizations(),public.read_owned_financial_months(uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_read_owned_financial_month(uuid,uuid),public.list_owned_organizations(),public.read_owned_financial_months(uuid,integer) TO authenticated;
DROP POLICY "financial_months: own rows" ON public.financial_months;
CREATE POLICY financial_months_organization_owner_read ON public.financial_months FOR SELECT TO authenticated
  USING(public.can_read_owned_financial_month(business_id,user_id));
COMMENT ON FUNCTION public.read_owned_financial_months(uuid,integer) IS 'ORG-01C authenticated verified original-owner monthly read. Target legacy subscription bridge; no actor argument or write capability.';
COMMIT;
