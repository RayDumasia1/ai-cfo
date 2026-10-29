-- ORG-01D3. Preview first. Owner-only authenticated write boundary.
-- Existing import engines remain owner-callable implementation details.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF current_user<>'postgres' OR to_regclass('organization_private.financial_scopes') IS NULL
    OR to_regprocedure('public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Postgres and complete D2/import prerequisites required'; END IF;
  IF to_regprocedure('public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'D3 already installed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid=ANY(ARRAY['public.business_profiles'::regclass,'public.financial_months'::regclass,
    'public.expense_categories'::regclass,'public.data_imports'::regclass]) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'Enabled owner RLS required'; END IF;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
END $$;

CREATE TABLE organization_private.monthly_write_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_reference uuid NOT NULL,
  business_profile_reference uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('import','clear','settings')),
  request_id uuid NOT NULL,
  policy_version text NOT NULL CHECK(policy_version='org-owner-write-1'),
  access_revision bigint NOT NULL,
  membership_revision bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE organization_private.monthly_write_events FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION organization_private.immutable_monthly_write_event() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Monthly write attribution is immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER monthly_write_events_immutable BEFORE UPDATE OR DELETE ON organization_private.monthly_write_events
  FOR EACH ROW EXECUTE FUNCTION organization_private.immutable_monthly_write_event();

CREATE FUNCTION public.verified_monthly_actor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL);
$$;
CREATE FUNCTION organization_private.ensure_monthly_profile() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); profile_id uuid;
BEGIN
  IF NOT public.verified_monthly_actor() THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
  SELECT id INTO profile_id FROM public.business_profiles WHERE user_id=actor;
  IF profile_id IS NULL THEN
    INSERT INTO public.business_profiles(user_id) VALUES(actor) ON CONFLICT(user_id) DO NOTHING;
    SELECT id INTO STRICT profile_id FROM public.business_profiles WHERE user_id=actor;
  END IF;
  RETURN profile_id;
END $$;
CREATE FUNCTION public.ensure_owned_business_profile() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE profile_id uuid;
BEGIN
  profile_id:=organization_private.ensure_monthly_profile();
  PERFORM organization_private.resolve_owner_read(auth.uid(),NULL);
  RETURN (SELECT to_jsonb(p) FROM public.business_profiles p WHERE id=profile_id AND user_id=auth.uid());
END $$;

CREATE FUNCTION organization_private.lock_monthly_owner(p_organization uuid,p_paid boolean,p_provision boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); profile_id uuid; org_id uuid; context jsonb; tier text; verified_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Owner writes require READ COMMITTED' USING ERRCODE='0A000'; END IF;
  IF NOT public.verified_monthly_actor() THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
  SELECT id INTO profile_id FROM public.business_profiles WHERE user_id=actor;
  IF profile_id IS NULL THEN
    IF NOT p_provision OR p_organization IS NOT NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
    IF p_paid AND organization_private.owner_monthly_entitlement(actor) IS NULL THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='P0402'; END IF;
    -- New, uncommitted profile/organization only. Existing rows are never
    -- upserted before the root locks, preserving the order for existing data.
    profile_id:=organization_private.ensure_monthly_profile();
  END IF;
  SELECT organization_id INTO org_id FROM organization_private.financial_scopes WHERE legacy_business_profile_id=profile_id AND legacy_user_id=actor;
  IF org_id IS NULL THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='55000'; END IF;
  IF p_organization IS NOT NULL AND p_organization<>org_id THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM id FROM public.organizations WHERE id=org_id FOR UPDATE;
  -- Auth/profile/billing legacy paths may hold these rows before a root.
  -- NOWAIT breaks that inversion instead of waiting in a deadlock cycle.
  SELECT email_confirmed_at INTO verified_at FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
  PERFORM id FROM public.organization_memberships WHERE organization_id=org_id AND user_id=actor FOR SHARE NOWAIT;
  PERFORM id FROM public.business_profiles WHERE id=profile_id AND user_id=actor FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  context:=organization_private.resolve_owner_read(actor,org_id);
  IF context IS NULL OR context->>'businessProfileId'<>profile_id::text OR NOT EXISTS(
    SELECT 1 FROM organization_private.financial_scopes WHERE organization_id=org_id AND legacy_business_profile_id=profile_id AND legacy_user_id=actor) THEN
    RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='55000'; END IF;
  IF p_paid THEN
    PERFORM user_id FROM public.subscriptions WHERE user_id=actor FOR SHARE NOWAIT;
    tier:=organization_private.owner_monthly_entitlement(actor);
    IF tier IS NULL THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='P0402'; END IF;
  END IF;
  RETURN context||jsonb_build_object('policyVersion','org-owner-write-1','capability','financial.months.write',
    'entitlementTier',tier,'entitlementSource','legacy_subscription','verificationVersion',extract(epoch FROM verified_at)::text);
END $$;
CREATE FUNCTION organization_private.monthly_review_state(p_context jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT state||jsonb_build_object('state_version',md5(jsonb_build_object('policy','org-owner-write-1',
    'actor',p_context->>'actorId','organization',p_context->>'organizationId','profile',p_context->>'businessProfileId',
    'access_revision',p_context->'accessRevision','membership_revision',p_context->'membershipRevision',
    'tier',p_context->>'entitlementTier','verification',p_context->>'verificationVersion','state',state->>'state_version')::text))
  FROM (SELECT public.financial_import_review_state((p_context->>'actorId')::uuid) AS state) source;
$$;
CREATE FUNCTION organization_private.record_monthly_write(p_context jsonb,p_operation text,p_request uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO organization_private.monthly_write_events(organization_id,actor_reference,business_profile_reference,operation,request_id,policy_version,access_revision,membership_revision)
    VALUES((p_context->>'organizationId')::uuid,(p_context->>'actorId')::uuid,(p_context->>'businessProfileId')::uuid,p_operation,
      coalesce(p_request,gen_random_uuid()),'org-owner-write-1',(p_context->>'accessRevision')::bigint,(p_context->>'membershipRevision')::bigint);
$$;
CREATE FUNCTION public.owned_monthly_operation(p_operation text,p_organization_id uuid DEFAULT NULL,p_months jsonb DEFAULT '[]',p_profile jsonb DEFAULT '{}',
  p_mode text DEFAULT 'update_months',p_filename text DEFAULT NULL,p_expected_state text DEFAULT NULL,p_request_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); context jsonb; state jsonb; legacy_state text; unchanged boolean:=false; result jsonb;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('authorize','review','confirm','clear','audit_failure') THEN
    RAISE EXCEPTION 'Unsupported monthly operation' USING ERRCODE='22023'; END IF;
  IF (p_profile IS NOT NULL AND pg_column_size(p_profile)>16384) OR (p_filename IS NOT NULL AND length(p_filename)>1024) THEN
    RAISE EXCEPTION 'Monthly request exceeds supported size' USING ERRCODE='22023'; END IF;
  IF p_operation='authorize' THEN
    IF NOT public.verified_monthly_actor() THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
    context:=organization_private.resolve_owner_read(actor,p_organization_id);
    IF organization_private.owner_monthly_entitlement(actor) IS NULL THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='P0402'; END IF;
    RETURN jsonb_build_object('authorized',true,'actorId',actor,'organizationId',context->>'organizationId');
  END IF;
  IF p_operation IN ('review','confirm') AND (p_mode IS NULL OR p_mode NOT IN ('update_months','replace_all') OR
    jsonb_typeof(p_months) IS DISTINCT FROM 'array' OR jsonb_array_length(p_months) NOT BETWEEN 1 AND 240 OR
    jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR pg_column_size(p_months)>2097152) THEN
    RAISE EXCEPTION 'Invalid monthly payload' USING ERRCODE='22023'; END IF;
  context:=organization_private.lock_monthly_owner(p_organization_id,true,p_operation IN ('review','clear'));
  IF EXISTS(SELECT 1 FROM public.financial_months WHERE user_id=actor AND (organization_id<>(context->>'organizationId')::uuid OR business_id IS DISTINCT FROM (context->>'businessProfileId')::uuid))
    OR EXISTS(SELECT 1 FROM public.expense_categories WHERE user_id=actor AND (organization_id<>(context->>'organizationId')::uuid OR business_id IS DISTINCT FROM (context->>'businessProfileId')::uuid)) THEN
    RAISE EXCEPTION 'Financial scope requires reviewed repair' USING ERRCODE='55000'; END IF;
  IF p_operation='review' THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_months) m(value) WHERE coalesce((m.value->>'data_contract_version')::int,1)<>2) THEN
      unchanged:=public.financial_import_v2_is_unchanged(actor,p_months,p_profile,p_mode);
    END IF;
    state:=organization_private.monthly_review_state(context);
    RETURN jsonb_build_object('context',context,'reviewState',state,'unchanged',unchanged);
  ELSIF p_operation='confirm' THEN
    state:=organization_private.monthly_review_state(context);
    IF p_expected_state IS NULL OR p_expected_state !~ '^[a-f0-9]{32}$' OR p_expected_state<>state->>'state_version' THEN
      RAISE EXCEPTION 'import_review_stale' USING ERRCODE='P0001'; END IF;
    legacy_state:=public.financial_import_review_state(actor)->>'state_version';
    result:=public.import_reviewed_financial_data(actor,p_months,p_profile,p_filename,p_mode,legacy_state);
    IF NOT coalesce((result->>'unchanged')::boolean,false) THEN PERFORM organization_private.record_monthly_write(context,'import',p_request_id); END IF;
    RETURN result||jsonb_build_object('actorId',actor,'organizationId',context->>'organizationId');
  ELSIF p_operation='clear' THEN
    result:=public.clear_financial_data_preserving_settings(actor);
    PERFORM organization_private.record_monthly_write(context,'clear',p_request_id);
    RETURN result||jsonb_build_object('actorId',actor,'organizationId',context->>'organizationId');
  ELSE
    IF p_filename IS NULL OR length(p_filename)>1024 THEN RAISE EXCEPTION 'Invalid audit filename' USING ERRCODE='22023'; END IF;
    INSERT INTO public.data_imports(user_id,import_type,filename,months_imported,status,error_message)
      VALUES(actor,'excel',p_filename,0,'error','Import could not be confirmed.') RETURNING to_jsonb(data_imports.*) INTO result;
    RETURN result;
  END IF;
END $$;
CREATE FUNCTION public.update_owned_business_profile(p_patch jsonb,p_organization_id uuid DEFAULT NULL,p_request_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; result public.business_profiles%ROWTYPE; field text; number_value numeric;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k(value)
    WHERE k.value NOT IN ('business_name','min_cash_reserve','runway_warning_threshold','runway_danger_threshold','burn_rate_warning_pct','invoice_overdue_days')) THEN
    RAISE EXCEPTION 'Unsupported profile fields' USING ERRCODE='22023'; END IF;
  IF p_patch?'business_name' AND (jsonb_typeof(p_patch->'business_name') NOT IN ('string','null') OR length(p_patch->>'business_name')>200) THEN
    RAISE EXCEPTION 'Invalid business name' USING ERRCODE='22023'; END IF;
  FOR field IN SELECT jsonb_object_keys(p_patch-'business_name') LOOP
    IF jsonb_typeof(p_patch->field)='null' AND field='min_cash_reserve' THEN CONTINUE; END IF;
    IF jsonb_typeof(p_patch->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid threshold' USING ERRCODE='22023'; END IF;
    number_value:=(p_patch->>field)::numeric;
    IF number_value<0 OR (field<>'min_cash_reserve' AND number_value=0) OR number_value::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Invalid threshold' USING ERRCODE='22023'; END IF;
  END LOOP;
  context:=organization_private.lock_monthly_owner(p_organization_id,false,true);
  SELECT * INTO STRICT result FROM public.business_profiles WHERE id=(context->>'businessProfileId')::uuid;
  result:=jsonb_populate_record(result,p_patch);
  IF result.runway_warning_threshold IS NOT NULL AND result.runway_danger_threshold IS NOT NULL AND result.runway_danger_threshold>=result.runway_warning_threshold THEN
    RAISE EXCEPTION 'Invalid threshold ordering' USING ERRCODE='22023'; END IF;
  UPDATE public.business_profiles SET business_name=CASE WHEN result.business_name IS NULL THEN NULL ELSE nullif(btrim(result.business_name),'') END,
    min_cash_reserve=result.min_cash_reserve,runway_warning_threshold=result.runway_warning_threshold,runway_danger_threshold=result.runway_danger_threshold,
    burn_rate_warning_pct=result.burn_rate_warning_pct,invoice_overdue_days=result.invoice_overdue_days
    WHERE id=result.id RETURNING * INTO result;
  PERFORM organization_private.record_monthly_write(context,'settings',p_request_id);
  RETURN to_jsonb(result);
END $$;

-- These profile consumers must move with the UPDATE privilege closure too.
-- Completion keeps its first database timestamp; preferences cannot set any
-- financial/profile identity or data-version field.
CREATE FUNCTION public.update_owned_profile_preferences(p_snooze_duration text DEFAULT NULL,p_complete_onboarding boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
  IF p_complete_onboarding IS NULL OR (p_snooze_duration IS NULL AND NOT p_complete_onboarding)
    OR (p_snooze_duration IS NOT NULL AND p_snooze_duration NOT IN ('24h','7d','data_reload')) THEN
    RAISE EXCEPTION 'Invalid profile preference' USING ERRCODE='22023'; END IF;
  context:=organization_private.lock_monthly_owner(NULL,false,true);
  UPDATE public.business_profiles SET snooze_duration=coalesce(p_snooze_duration,snooze_duration),
    onboarding_completed_at=CASE WHEN p_complete_onboarding THEN coalesce(onboarding_completed_at,clock_timestamp()) ELSE onboarding_completed_at END
    WHERE id=(context->>'businessProfileId')::uuid;
  RETURN jsonb_build_object('success',true,'actorId',auth.uid(),'organizationId',context->>'organizationId');
END $$;
REVOKE ALL ON FUNCTION public.update_owned_profile_preferences(text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_owned_profile_preferences(text,boolean) TO authenticated;

CREATE FUNCTION public.can_read_owned_monthly_scope(p_organization uuid,p_legacy_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_legacy_user THEN RETURN false; END IF;
  BEGIN context:=organization_private.resolve_owner_read(auth.uid(),p_organization);
    EXCEPTION WHEN insufficient_privilege OR no_data_found OR object_not_in_prerequisite_state THEN RETURN false; END;
  RETURN context IS NOT NULL AND p_organization=(context->>'organizationId')::uuid
    AND organization_private.owner_monthly_entitlement(auth.uid()) IS NOT NULL
    AND EXISTS(SELECT 1 FROM organization_private.financial_scopes s WHERE s.organization_id=p_organization
      AND s.legacy_business_profile_id=(context->>'businessProfileId')::uuid AND s.legacy_user_id=auth.uid());
END $$;
DO $$ DECLARE name text; policy record; BEGIN
  FOREACH name IN ARRAY ARRAY['business_profiles','financial_months','expense_categories','data_imports'] LOOP
    FOR policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=name LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',policy.policyname,name);
    END LOOP;
  END LOOP;
END $$;
CREATE POLICY business_profile_owner_select ON public.business_profiles FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY business_profile_verified_insert ON public.business_profiles FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id AND public.verified_monthly_actor());
CREATE POLICY financial_months_organization_owner_read ON public.financial_months FOR SELECT TO authenticated
  USING(public.can_read_owned_financial_month(business_id,user_id) AND public.can_read_owned_monthly_scope(organization_id,user_id));
CREATE POLICY expense_categories_organization_owner_read ON public.expense_categories FOR SELECT TO authenticated
  USING(public.can_read_owned_monthly_scope(organization_id,user_id));
CREATE POLICY data_imports_organization_owner_read ON public.data_imports FOR SELECT TO authenticated
  USING(public.can_read_owned_monthly_scope(organization_id,user_id));
REVOKE INSERT,UPDATE,DELETE ON public.financial_months,public.expense_categories,public.data_imports,public.financial_data_revisions FROM PUBLIC,anon,authenticated,service_role;
REVOKE UPDATE,DELETE ON public.business_profiles FROM PUBLIC,anon,authenticated,service_role;
REVOKE INSERT ON public.business_profiles FROM PUBLIC,anon,service_role;
-- Unconverted weekly/provider engines require SELECT FOR UPDATE but must not
-- retain a direct settings-write path. B rejects any actual identity change.
GRANT UPDATE(id) ON public.business_profiles TO service_role;
REVOKE USAGE ON SEQUENCE public.financial_data_revisions_id_seq FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.replace_financial_import(uuid,jsonb,jsonb,text),public.import_financial_data(uuid,jsonb,jsonb,text,text),
  public.import_financial_data_v2(uuid,jsonb,jsonb,text,text),public.import_reviewed_financial_data(uuid,jsonb,jsonb,text,text,text),
  public.financial_import_review_state(uuid),public.financial_import_v2_is_unchanged(uuid,jsonb,jsonb,text),
  public.clear_financial_data(uuid),public.clear_financial_data_preserving_settings(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION organization_private.immutable_monthly_write_event(),organization_private.ensure_monthly_profile(),
  organization_private.lock_monthly_owner(uuid,boolean,boolean),organization_private.monthly_review_state(jsonb),organization_private.record_monthly_write(jsonb,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.verified_monthly_actor(),public.ensure_owned_business_profile(),public.update_owned_business_profile(jsonb,uuid,uuid),
  public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid),public.can_read_owned_monthly_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verified_monthly_actor(),public.ensure_owned_business_profile(),public.update_owned_business_profile(jsonb,uuid,uuid),
  public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid),public.can_read_owned_monthly_scope(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_owned_financial_months(p_organization_id uuid DEFAULT NULL,p_limit integer DEFAULT 12) RETURNS jsonb
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
  IF EXISTS(SELECT 1 FROM public.financial_months WHERE user_id=actor AND (business_id IS DISTINCT FROM profile_id OR organization_id IS DISTINCT FROM (context->>'organizationId')::uuid)) THEN
    RAISE EXCEPTION 'Monthly ownership evidence unavailable' USING ERRCODE='55000'; END IF;
  IF p_limit IS NULL AND (SELECT count(*) FROM public.financial_months WHERE user_id=actor AND business_id=profile_id AND organization_id=(context->>'organizationId')::uuid)>240 THEN
    RAISE EXCEPTION 'Monthly history exceeds supported read size' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.month_date DESC),'[]'::jsonb) INTO months FROM (
    SELECT * FROM public.financial_months WHERE user_id=actor AND business_id=profile_id AND organization_id=(context->>'organizationId')::uuid ORDER BY month_date DESC LIMIT coalesce(p_limit,240)
  ) f;
  RETURN jsonb_build_object('state','ready','context',context||jsonb_build_object('capability','financial.months.read',
    'policyVersion','org-owner-read-1','entitlementTier',tier,'entitlementSource','legacy_subscription'),'months',months);
END $$;

COMMENT ON FUNCTION public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid) IS 'D3 auth.uid-bound original-owner monthly authority; closed capability operations, current locked Auth/grants/target entitlement and review state. No actor input or service grant.';
COMMIT;
