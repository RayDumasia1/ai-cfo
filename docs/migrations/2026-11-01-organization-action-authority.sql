-- ORG-01D4C. Preview first. Authenticated original-owner action/budget cutover.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF current_user<>'postgres' OR to_regclass('organization_private.action_scope_repairs') IS NULL THEN
    RAISE EXCEPTION 'Postgres and complete D4B prerequisites required'; END IF;
  IF to_regprocedure('public.owned_action_operation(text,uuid,uuid,jsonb,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'D4C already installed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.subscriptions'::regclass AND attname='billing_period_start' AND NOT attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.subscriptions'::regclass AND attname='billing_period_end' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Stored billing-period columns required'; END IF;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
END $$;
CREATE TABLE organization_private.operational_write_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_reference uuid NOT NULL,resource_reference uuid NOT NULL,operation text NOT NULL CHECK(operation IN('create','update','delete','consume')),
  request_id uuid NOT NULL,policy_version text NOT NULL CHECK(policy_version='org-operations-1'),access_revision bigint NOT NULL,membership_revision bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON organization_private.operational_write_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operational_write_events_immutable BEFORE UPDATE OR DELETE ON organization_private.operational_write_events
  FOR EACH ROW EXECUTE FUNCTION organization_private.immutable_action_scope_repair();
CREATE FUNCTION organization_private.lock_operational_owner(p_organization uuid,p_billing boolean,p_provision boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); profile_id uuid; org_id uuid; context jsonb;
BEGIN
  IF current_setting('transaction_isolation') NOT IN('read committed','read uncommitted') THEN RAISE EXCEPTION 'Operations require READ COMMITTED' USING ERRCODE='0A000'; END IF;
  IF NOT public.verified_monthly_actor() THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
  SELECT id INTO profile_id FROM public.business_profiles WHERE user_id=actor;
  IF profile_id IS NULL THEN
    IF NOT p_provision OR p_organization IS NOT NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
    profile_id:=(public.ensure_owned_business_profile()->>'id')::uuid;
  END IF;
  SELECT organization_id INTO org_id FROM organization_private.financial_scopes WHERE legacy_business_profile_id=profile_id AND legacy_user_id=actor;
  IF org_id IS NULL THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='55000'; END IF;
  IF p_organization IS NOT NULL AND p_organization<>org_id THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM id FROM public.organizations WHERE id=org_id FOR UPDATE;
  PERFORM id FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501'; END IF;
  PERFORM id FROM public.organization_memberships WHERE organization_id=org_id AND user_id=actor FOR SHARE NOWAIT;
  PERFORM id FROM public.business_profiles WHERE id=profile_id AND user_id=actor FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
  context:=organization_private.resolve_owner_read(actor,org_id);
  IF context IS NULL OR context->>'businessProfileId'<>profile_id::text THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='55000'; END IF;
  IF p_billing THEN PERFORM user_id FROM public.subscriptions WHERE user_id=actor FOR NO KEY UPDATE NOWAIT; END IF;
  RETURN context||jsonb_build_object('policyVersion','org-operations-1');
END $$;
CREATE FUNCTION organization_private.record_operational_write(p_context jsonb,p_resource uuid,p_operation text,p_request uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO organization_private.operational_write_events(organization_id,actor_reference,resource_reference,operation,request_id,policy_version,access_revision,membership_revision)
    VALUES((p_context->>'organizationId')::uuid,auth.uid(),p_resource,p_operation,coalesce(p_request,gen_random_uuid()),'org-operations-1',
      (p_context->>'accessRevision')::bigint,(p_context->>'membershipRevision')::bigint);
$$;
-- The wrapper holds root/principal/profile/subscription first. The retained
-- AFTER trigger never waits on a predecessor when invoked by legacy/admin SQL.
CREATE OR REPLACE FUNCTION public.enforce_action_capacity() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE tier text; capacity integer; active_count bigint;
BEGIN
  IF NEW.status='completed' THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' THEN IF OLD.status<>'completed' AND OLD.organization_id=NEW.organization_id THEN RETURN NULL; END IF; END IF;
  IF current_setting('transaction_isolation') NOT IN('read committed','read uncommitted') THEN RAISE EXCEPTION 'Action slots require READ COMMITTED' USING ERRCODE='0A000'; END IF;
  SELECT feature_tier INTO tier FROM public.subscriptions WHERE user_id=NEW.user_id FOR NO KEY UPDATE NOWAIT;
  IF tier='suspended' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='action_limit_reached',DETAIL='0'; END IF;
  IF organization_private.owner_monthly_entitlement(NEW.user_id) IS NULL THEN RAISE EXCEPTION 'Subscription required' USING ERRCODE='P0402'; END IF;
  CASE tier WHEN 'starter' THEN capacity:=10; WHEN 'core' THEN capacity:=50; WHEN 'growth','advisory' THEN RETURN NULL;
    ELSE RAISE EXCEPTION 'Capacity unavailable' USING ERRCODE='55000'; END CASE;
  SELECT count(*) INTO active_count FROM public.actions WHERE organization_id=NEW.organization_id AND status<>'completed';
  IF active_count>capacity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='action_limit_reached',DETAIL=capacity::text; END IF;
  RETURN NULL;
END $$;
CREATE INDEX actions_organization_active_capacity_idx ON public.actions(organization_id) WHERE status<>'completed';
CREATE FUNCTION organization_private.validate_new_action(p_patch jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE field text; patch public.actions%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR pg_column_size(p_patch)>16384 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k(value)
    WHERE k.value NOT IN('name','description','goal_type','goal_value','goal_unit','status','due_date','linked_alert_code','actual_impact','actual_impact_notes','linked_forecast_version_id','linked_forecast_item_id')) THEN
    RAISE EXCEPTION 'Invalid action payload' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_patch->'name') IS DISTINCT FROM 'string' OR length(btrim(p_patch->>'name')) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(p_patch->'goal_type') IS DISTINCT FROM 'string' OR p_patch->>'goal_type' NOT IN('revenue_increase','expense_reduction','runway_improvement','risk_mitigation') THEN
    RAISE EXCEPTION 'Action name and goal required' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['description','linked_alert_code','actual_impact_notes'] LOOP
    IF p_patch?field AND jsonb_typeof(p_patch->field)<>'null' AND (jsonb_typeof(p_patch->field)<>'string' OR length(p_patch->>field)>CASE WHEN field='linked_alert_code' THEN 64 ELSE 500 END) THEN
      RAISE EXCEPTION 'Invalid action text' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['goal_value','actual_impact'] LOOP
    IF p_patch?field AND jsonb_typeof(p_patch->field) NOT IN('number','null') THEN RAISE EXCEPTION 'Invalid action number' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_patch?'status' AND (jsonb_typeof(p_patch->'status') IS DISTINCT FROM 'string' OR p_patch->>'status' NOT IN('not_started','in_progress','completed')) THEN
    RAISE EXCEPTION 'Invalid action status' USING ERRCODE='22023'; END IF;
  IF p_patch?'goal_unit' AND jsonb_typeof(p_patch->'goal_unit')<>'null' AND (jsonb_typeof(p_patch->'goal_unit')<>'string' OR p_patch->>'goal_unit' NOT IN('usd','percent','months','units')) THEN
    RAISE EXCEPTION 'Invalid action unit' USING ERRCODE='22023'; END IF;
  IF p_patch?'due_date' AND jsonb_typeof(p_patch->'due_date')<>'null' AND (jsonb_typeof(p_patch->'due_date')<>'string' OR p_patch->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'Invalid action date' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['linked_forecast_version_id','linked_forecast_item_id'] LOOP
    IF p_patch?field AND jsonb_typeof(p_patch->field) NOT IN('string','null') THEN RAISE EXCEPTION 'Invalid forecast reference' USING ERRCODE='22023'; END IF;
  END LOOP;
  patch:=jsonb_populate_record(NULL::public.actions,p_patch);
  IF patch.linked_forecast_item_id IS NOT NULL AND patch.linked_forecast_version_id IS NULL THEN RAISE EXCEPTION 'Item requires version' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION public.owned_action_operation(p_operation text,p_organization_id uuid DEFAULT NULL,p_action_id uuid DEFAULT NULL,p_patch jsonb DEFAULT '{}',p_audit_note text DEFAULT NULL,p_request_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; org uuid; actor uuid:=auth.uid(); row_value public.actions%ROWTYPE; patch public.actions%ROWTYPE; result jsonb; locked_version uuid; locked_item uuid;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN('list','get','history','count','create','update','delete') THEN RAISE EXCEPTION 'Unsupported action operation' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR pg_column_size(p_patch)>16384 OR length(p_audit_note)>500 THEN RAISE EXCEPTION 'Invalid action request' USING ERRCODE='22023'; END IF;
  context:=organization_private.lock_operational_owner(p_organization_id,p_operation IN('create','update','delete'),p_operation='create');org:=(context->>'organizationId')::uuid;
  IF p_operation='list' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k(value) WHERE k.value<>'statuses') OR (p_patch?'statuses' AND
      (jsonb_typeof(p_patch->'statuses') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_patch->'statuses') s(value) WHERE value IS NULL OR value NOT IN('not_started','in_progress','completed')))) THEN
      RAISE EXCEPTION 'Invalid action filter' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]') INTO result FROM public.actions a WHERE a.organization_id=org AND a.user_id=actor
      AND (NOT p_patch?'statuses' OR a.status IN(SELECT jsonb_array_elements_text(p_patch->'statuses')));
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','actions',result);
  ELSIF p_operation='count' THEN
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','count',(SELECT count(*) FROM public.actions WHERE organization_id=org AND user_id=actor AND status<>'completed'));
  ELSIF p_operation='create' THEN
    PERFORM organization_private.validate_new_action(p_patch);patch:=jsonb_populate_record(NULL::public.actions,p_patch);
    IF patch.linked_forecast_version_id IS NOT NULL THEN
      SELECT v.id INTO locked_version FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id
        WHERE v.id=patch.linked_forecast_version_id AND v.user_id=actor AND f.user_id=actor AND f.business_id=(context->>'businessProfileId')::uuid FOR KEY SHARE OF v,f NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'Forecast unavailable' USING ERRCODE='P0002'; END IF;
      IF patch.linked_forecast_item_id IS NOT NULL THEN
        SELECT id INTO locked_item FROM public.cash_forecast_items WHERE id=patch.linked_forecast_item_id AND version_id=locked_version AND user_id=actor FOR KEY SHARE NOWAIT;
        IF NOT FOUND THEN RAISE EXCEPTION 'Forecast item unavailable' USING ERRCODE='P0002'; END IF;
      END IF;
    END IF;
    INSERT INTO public.actions(user_id,business_id,organization_id,name,description,goal_type,goal_value,goal_unit,status,due_date,linked_alert_code,actual_impact,actual_impact_notes,linked_forecast_version_id,linked_forecast_item_id)
      VALUES(actor,(context->>'businessProfileId')::uuid,org,btrim(patch.name),patch.description,patch.goal_type,patch.goal_value,patch.goal_unit,coalesce(patch.status,'not_started'),patch.due_date,patch.linked_alert_code,
        patch.actual_impact,patch.actual_impact_notes,patch.linked_forecast_version_id,patch.linked_forecast_item_id) RETURNING * INTO row_value;
  ELSE
    IF p_operation IN('update','delete') THEN
      SELECT * INTO row_value FROM public.actions WHERE id=p_action_id AND user_id=actor AND organization_id=org FOR NO KEY UPDATE NOWAIT;
    ELSE SELECT * INTO row_value FROM public.actions WHERE id=p_action_id AND user_id=actor AND organization_id=org; END IF;
    IF NOT FOUND THEN
      IF p_operation='get' THEN RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','action',NULL); END IF;
      RAISE EXCEPTION 'Action unavailable' USING ERRCODE='P0002'; END IF;
    IF p_operation='get' THEN RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','action',to_jsonb(row_value)); END IF;
    IF p_operation='history' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC),'[]') INTO result FROM public.action_audit_log h WHERE h.action_id=row_value.id AND h.user_id=actor AND h.organization_id=org;
      RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','history',result); END IF;
    IF p_operation='update' THEN
      result:=public.update_action_with_audit(actor,p_action_id,p_patch,p_audit_note);row_value:=jsonb_populate_record(NULL::public.actions,result);
    ELSE DELETE FROM public.actions WHERE id=row_value.id AND user_id=actor AND organization_id=org; END IF;
  END IF;
  PERFORM organization_private.record_operational_write(context,row_value.id,p_operation,p_request_id);
  RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','action',CASE WHEN p_operation='delete' THEN NULL ELSE to_jsonb(row_value) END,'deleted',p_operation='delete');
END $$;
CREATE FUNCTION public.owned_usage_operation(p_operation text,p_metric text DEFAULT NULL,p_organization_id uuid DEFAULT NULL,p_period_start timestamptz DEFAULT NULL,p_request_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; org uuid; actor uuid:=auth.uid(); subscription public.subscriptions%ROWTYPE; quota integer; result jsonb; usage_row public.usage_tracking%ROWTYPE; items jsonb:='[]'; current_metric text;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN('status','consume','mark_warning') OR (p_operation<>'status' AND (p_metric IS NULL OR p_metric NOT IN('ask_cfo_questions','ai_insight_runs'))) THEN
    RAISE EXCEPTION 'Unsupported quota operation' USING ERRCODE='22023'; END IF;
  context:=organization_private.lock_operational_owner(p_organization_id,true,false);org:=(context->>'organizationId')::uuid;
  SELECT * INTO subscription FROM public.subscriptions WHERE user_id=actor;
  IF subscription.feature_tier IS NULL OR subscription.feature_tier NOT IN('starter','core','growth','advisory','suspended') THEN RAISE EXCEPTION 'Coverage unavailable' USING ERRCODE='55000'; END IF;
  IF p_operation='status' AND subscription.feature_tier IN('starter','advisory','suspended') THEN
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','entitlementTier',subscription.feature_tier,'usage','[]'::jsonb); END IF;
  IF p_operation<>'status' AND (organization_private.owner_monthly_entitlement(actor) IS NULL OR subscription.feature_tier NOT IN('core','growth','advisory')) THEN
    RAISE EXCEPTION 'Subscription required' USING ERRCODE='P0402'; END IF;
  IF p_operation='consume' AND (subscription.feature_tier='advisory' OR (subscription.feature_tier='growth' AND p_metric='ai_insight_runs')) THEN
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','allowed',true,'throttled',false,'count',0,'usage_limit',NULL,'warning_sent_at',NULL,
      'entitlementTier',subscription.feature_tier,'periodStart',NULL); END IF;
  IF subscription.billing_period_start IS NULL OR subscription.billing_period_end IS NULL OR subscription.billing_period_end<=subscription.billing_period_start
    OR subscription.billing_period_start>clock_timestamp() OR subscription.billing_period_end<=clock_timestamp() THEN
    RAISE EXCEPTION 'Current billing window unavailable' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM public.usage_tracking WHERE user_id=actor AND period_start=subscription.billing_period_start AND organization_id<>org) THEN RAISE EXCEPTION 'Historical usage scope unavailable' USING ERRCODE='55000'; END IF;
  IF p_operation='status' THEN
    FOREACH current_metric IN ARRAY ARRAY['ask_cfo_questions','ai_insight_runs'] LOOP
      quota:=CASE WHEN current_metric='ask_cfo_questions' THEN CASE WHEN subscription.feature_tier='core' THEN 20 ELSE 150 END ELSE CASE WHEN subscription.feature_tier='core' THEN 3 ELSE NULL END END;
      SELECT * INTO usage_row FROM public.usage_tracking WHERE organization_id=org AND user_id=actor AND usage_tracking.metric=current_metric AND period_start=subscription.billing_period_start;
      items:=items||jsonb_build_array(jsonb_build_object('metric',current_metric,'count',coalesce(usage_row.count,0),'limit',quota));
    END LOOP;
    items:=items||jsonb_build_array(jsonb_build_object('metric','actions_active','count',(SELECT count(*) FROM public.actions WHERE organization_id=org AND user_id=actor AND status<>'completed'),'limit',CASE WHEN subscription.feature_tier='core' THEN 50 ELSE NULL END));
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','entitlementTier',subscription.feature_tier,'usage',items);
  ELSIF p_operation='mark_warning' THEN
    IF subscription.feature_tier<>'growth' OR p_metric<>'ask_cfo_questions' OR p_period_start IS DISTINCT FROM subscription.billing_period_start THEN RAISE EXCEPTION 'Warning period changed' USING ERRCODE='P0002'; END IF;
    UPDATE public.usage_tracking SET warning_sent_at=coalesce(warning_sent_at,clock_timestamp()) WHERE organization_id=org AND user_id=actor AND metric=p_metric AND period_start=p_period_start AND count>=100;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consumed warning period unavailable' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','marked',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.usage_tracking WHERE user_id=actor AND metric=p_metric AND period_start=subscription.billing_period_start AND organization_id<>org) THEN
    RAISE EXCEPTION 'Historical usage scope requires reviewed repair' USING ERRCODE='55000'; END IF;
  quota:=CASE WHEN p_metric='ai_insight_runs' THEN 3 WHEN subscription.feature_tier='core' THEN 20 ELSE 150 END;
  result:=public.consume_usage(actor,p_metric,subscription.billing_period_start,subscription.billing_period_end,quota,subscription.feature_tier='growth');
  IF (result->>'allowed')::boolean THEN
    SELECT * INTO STRICT usage_row FROM public.usage_tracking WHERE organization_id=org AND user_id=actor AND metric=p_metric AND period_start=subscription.billing_period_start;
    PERFORM organization_private.record_operational_write(context,usage_row.id,'consume',p_request_id); END IF;
  RETURN result||jsonb_build_object('actorId',actor,'organizationId',org,'policyVersion','org-operations-1','entitlementTier',subscription.feature_tier,'periodStart',subscription.billing_period_start);
END $$;
CREATE FUNCTION public.can_read_operational_scope(p_organization uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_owner THEN RETURN false; END IF;
  BEGIN context:=organization_private.resolve_owner_read(auth.uid(),p_organization);
    EXCEPTION WHEN insufficient_privilege OR no_data_found OR object_not_in_prerequisite_state THEN RETURN false; END;
  RETURN context IS NOT NULL AND context->>'organizationId'=p_organization::text AND EXISTS(SELECT 1 FROM organization_private.financial_scopes s
    WHERE s.organization_id=p_organization AND s.legacy_user_id=auth.uid() AND s.legacy_business_profile_id=(context->>'businessProfileId')::uuid);
END $$;
DO $$ DECLARE target text; policy record; BEGIN
  FOREACH target IN ARRAY ARRAY['actions','action_audit_log','usage_tracking'] LOOP
    IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||target)::regclass) THEN RAISE EXCEPTION 'Enabled owner RLS required'; END IF;
    FOR policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=target LOOP EXECUTE format('DROP POLICY %I ON public.%I',policy.policyname,target); END LOOP;
    EXECUTE format('CREATE POLICY operational_owner_read ON public.%I FOR SELECT TO authenticated USING(public.can_read_operational_scope(organization_id,user_id))',target);
  END LOOP;
END $$;
DO $$ DECLARE target text; col record; BEGIN
  FOREACH target IN ARRAY ARRAY['actions','action_audit_log','usage_tracking'] LOOP
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=('public.'||target)::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE INSERT(%I),UPDATE(%I),REFERENCES(%I) ON public.%I FROM PUBLIC,anon,authenticated,service_role',col.attname,col.attname,col.attname,target);
    END LOOP;
  END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.actions,public.action_audit_log,public.usage_tracking FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_action_with_audit(uuid,uuid,jsonb,text),public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean),
  public.increment_usage(uuid,text,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN IF to_regprocedure('public.get_active_action_count(uuid)') IS NOT NULL THEN
  REVOKE ALL ON FUNCTION public.get_active_action_count(uuid) FROM PUBLIC,anon,authenticated,service_role; END IF; END $$;
REVOKE ALL ON FUNCTION organization_private.lock_operational_owner(uuid,boolean,boolean),organization_private.record_operational_write(jsonb,uuid,text,uuid),
  organization_private.validate_new_action(jsonb),public.enforce_action_capacity(),public.owned_action_operation(text,uuid,uuid,jsonb,text,uuid),
  public.owned_usage_operation(text,text,uuid,timestamptz,uuid),public.can_read_operational_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.owned_action_operation(text,uuid,uuid,jsonb,text,uuid),public.owned_usage_operation(text,text,uuid,timestamptz,uuid),
  public.can_read_operational_scope(uuid,uuid) TO authenticated;
COMMIT;
