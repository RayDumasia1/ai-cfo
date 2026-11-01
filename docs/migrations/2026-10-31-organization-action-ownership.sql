-- ORG-01D4B. One-time storage expansion and explicit null-business repair.
-- Preview first, postgres only. Does not convert authority or enable teams/AI.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
-- Exclude lifecycle, mapping, billing and forecast changes for the checked install.
-- Lock timeout aborts the whole transaction on competing legacy lock orders.
LOCK TABLE auth.users,public.organizations,public.organization_memberships,
  public.legacy_account_organizations,public.business_profiles,organization_private.financial_scopes,
  public.subscriptions,public.cash_forecasts,public.cash_forecast_versions,public.cash_forecast_items IN SHARE MODE;
LOCK TABLE public.actions,public.action_audit_log,public.usage_tracking IN ACCESS EXCLUSIVE MODE;
DO $$ DECLARE target text; BEGIN
  IF current_user<>'postgres' OR to_regprocedure('public.owned_monthly_operation(text,uuid,jsonb,jsonb,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Postgres and complete D3 prerequisites required'; END IF;
  IF to_regprocedure('public.consume_usage(uuid,text,timestamptz,timestamptz,integer,boolean)') IS NULL
    OR to_regprocedure('public.update_action_with_audit(uuid,uuid,jsonb,text)') IS NULL
    OR to_regprocedure('public.discard_cash_forecast_draft(uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Complete legacy action, quota and forecast prerequisites required'; END IF;
  IF to_regclass('organization_private.action_scope_repairs') IS NOT NULL THEN RAISE EXCEPTION 'D4B already installed or partial installation'; END IF;
  PERFORM organization_private.assert_shadow_organization(id) FROM public.organizations;
  FOREACH target IN ARRAY ARRAY['actions','action_audit_log','usage_tracking'] LOOP
    IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=('public.'||target)::regclass AND attname='organization_id' AND NOT attisdropped)
      OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||target)::regclass) THEN
      RAISE EXCEPTION 'Unexpected organization column or disabled owner RLS'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM (VALUES('public.actions','public.business_profiles','business_id','n'),
    ('public.actions','auth.users','user_id','c'),('public.action_audit_log','public.actions','action_id','c'),
    ('public.action_audit_log','auth.users','user_id','c'),('public.usage_tracking','auth.users','user_id','a')) expected(child,parent,column_name,deletion)
    WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname=expected.column_name
      WHERE c.conrelid=expected.child::regclass AND c.confrelid=expected.parent::regclass AND c.contype='f' AND c.convalidated
      AND c.conkey=ARRAY[a.attnum] AND c.confdeltype::text=expected.deletion)) THEN
    RAISE EXCEPTION 'Unexpected action/history/usage deletion constraints'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid=ANY(ARRAY['public.actions'::regclass,'public.action_audit_log'::regclass,'public.usage_tracking'::regclass]))<>3
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.actions'::regclass AND tgname='actions_set_updated_at' AND tgtype=19 AND tgenabled='O' AND tgfoid='public.set_updated_at()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.actions'::regclass AND tgname='actions_completed_at_trigger' AND tgtype=19 AND tgenabled='O' AND tgfoid='public.actions_set_completed_at()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.actions'::regclass AND tgname='enforce_action_capacity' AND tgtype=21 AND tgenabled='O' AND tgfoid='public.enforce_action_capacity()'::regprocedure)
    OR EXISTS(SELECT 1 FROM (VALUES('public.set_updated_at()','a3a8dcc15e232b73d3f5c4abfa43f3d8',false),
      ('public.actions_set_completed_at()','29dfa49357d6d3af614972c8bf584538',false),('public.enforce_action_capacity()','efebd661ab06ba9d67c35486dcde49f9',true)) expected(signature,digest,definer)
      JOIN pg_proc p ON p.oid=expected.signature::regprocedure WHERE md5(regexp_replace(p.prosrc,'[[:space:]]','','g'))<>expected.digest
        OR p.prosecdef<>expected.definer OR p.prorettype<>'trigger'::regtype OR p.provolatile<>'v'
        OR (expected.definer AND (p.proconfig IS NULL OR NOT('search_path=""'=ANY(p.proconfig))))) THEN
    RAISE EXCEPTION 'Review unexpected action or usage triggers before backfill'; END IF;
END $$;
CREATE TEMP TABLE d4b_owners ON COMMIT DROP AS
  SELECT p.user_id,p.id AS profile_id,l.organization_id,
    (SELECT count(*) FROM public.legacy_account_organizations h WHERE h.legacy_user_id=p.user_id) AS historical_scopes
  FROM public.business_profiles p JOIN public.legacy_account_organizations l ON l.current_business_profile_id=p.id AND l.legacy_user_id=p.user_id AND l.state='live'
  JOIN organization_private.financial_scopes s ON s.organization_id=l.organization_id AND s.legacy_business_profile_id=p.id AND s.legacy_user_id=p.user_id;
CREATE UNIQUE INDEX ON d4b_owners(user_id);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.actions a LEFT JOIN d4b_owners o ON o.user_id=a.user_id WHERE o.organization_id IS NULL
    OR (a.business_id IS NULL AND o.historical_scopes<>1) OR (a.business_id IS NOT NULL AND a.business_id<>o.profile_id)
    OR a.status IS NULL OR a.status NOT IN ('not_started','in_progress','completed'))
    OR EXISTS(SELECT 1 FROM public.actions a JOIN d4b_owners o ON o.user_id=a.user_id
      LEFT JOIN public.cash_forecast_versions v ON v.id=a.linked_forecast_version_id LEFT JOIN public.cash_forecasts f ON f.id=v.forecast_id
      LEFT JOIN public.cash_forecast_items i ON i.id=a.linked_forecast_item_id WHERE
      (a.linked_forecast_version_id IS NOT NULL AND (v.id IS NULL OR v.user_id IS DISTINCT FROM a.user_id OR f.id IS NULL OR f.user_id IS DISTINCT FROM a.user_id OR f.business_id IS DISTINCT FROM o.profile_id))
      OR (a.linked_forecast_item_id IS NOT NULL AND (a.linked_forecast_version_id IS NULL OR i.id IS NULL OR i.user_id IS DISTINCT FROM a.user_id OR i.version_id IS DISTINCT FROM a.linked_forecast_version_id)))
    OR EXISTS(SELECT 1 FROM public.action_audit_log h LEFT JOIN public.actions a ON a.id=h.action_id LEFT JOIN d4b_owners o ON o.user_id=h.user_id
      WHERE a.id IS NULL OR a.user_id IS DISTINCT FROM h.user_id OR o.organization_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.usage_tracking u LEFT JOIN d4b_owners o ON o.user_id=u.user_id WHERE o.organization_id IS NULL OR o.historical_scopes<>1
      OR u.count IS NULL OR u.count<0 OR u.usage_limit<0 OR u.period_start IS NULL OR u.period_end IS NULL OR u.period_end<=u.period_start
      OR u.metric IS NULL OR u.metric NOT IN ('ask_cfo_questions','ai_insight_runs','actions_created'))
    OR EXISTS(SELECT 1 FROM public.usage_tracking GROUP BY user_id,metric,period_start HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Action/audit/usage scope requires reviewed repair; no automatic reassignment'; END IF;
END $$;
CREATE TEMP TABLE d4b_before(table_name text,id uuid,row_value jsonb,expected_business uuid,PRIMARY KEY(table_name,id)) ON COMMIT DROP;
INSERT INTO d4b_before SELECT 'actions',a.id,to_jsonb(a),coalesce(a.business_id,o.profile_id) FROM public.actions a JOIN d4b_owners o ON o.user_id=a.user_id;
INSERT INTO d4b_before SELECT 'action_audit_log',id,to_jsonb(h),NULL FROM public.action_audit_log h;
INSERT INTO d4b_before SELECT 'usage_tracking',id,to_jsonb(u),NULL FROM public.usage_tracking u;
CREATE TABLE organization_private.action_scope_repairs(
  action_reference uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  legacy_owner_reference uuid NOT NULL,
  previous_business_reference uuid CHECK(previous_business_reference IS NULL),
  repaired_business_reference uuid NOT NULL,
  source_row_fingerprint text NOT NULL CHECK(source_row_fingerprint ~ '^[a-f0-9]{32}$'),
  policy_version text NOT NULL DEFAULT 'org-action-scope-repair-1' CHECK(policy_version='org-action-scope-repair-1'),
  database_operator text NOT NULL DEFAULT session_user,
  corrected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE organization_private.action_scope_repairs FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION organization_private.immutable_action_scope_repair() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Action scope correction evidence is immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER action_scope_repairs_immutable BEFORE UPDATE OR DELETE ON organization_private.action_scope_repairs FOR EACH ROW EXECUTE FUNCTION organization_private.immutable_action_scope_repair();
INSERT INTO organization_private.action_scope_repairs(action_reference,organization_id,legacy_owner_reference,repaired_business_reference,source_row_fingerprint)
  SELECT a.id,o.organization_id,a.user_id,o.profile_id,md5(b.row_value::text) FROM public.actions a
  JOIN d4b_owners o ON o.user_id=a.user_id JOIN d4b_before b ON b.table_name='actions' AND b.id=a.id WHERE a.business_id IS NULL;
ALTER TABLE public.actions ADD COLUMN organization_id uuid;
ALTER TABLE public.action_audit_log ADD COLUMN organization_id uuid;
ALTER TABLE public.usage_tracking ADD COLUMN organization_id uuid;
-- Both reviewed BEFORE UPDATE functions can rewrite old timestamps. Suspend
-- only these known functions; capacity remains enabled and takes no new slot.
ALTER TABLE public.actions DISABLE TRIGGER actions_set_updated_at;
ALTER TABLE public.actions DISABLE TRIGGER actions_completed_at_trigger;
UPDATE public.actions a SET organization_id=o.organization_id,business_id=coalesce(a.business_id,o.profile_id) FROM d4b_owners o WHERE o.user_id=a.user_id;
ALTER TABLE public.actions ENABLE TRIGGER actions_completed_at_trigger;
ALTER TABLE public.actions ENABLE TRIGGER actions_set_updated_at;
UPDATE public.action_audit_log h SET organization_id=a.organization_id FROM public.actions a WHERE a.id=h.action_id AND a.user_id=h.user_id;
UPDATE public.usage_tracking u SET organization_id=o.organization_id FROM d4b_owners o WHERE o.user_id=u.user_id;
DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['actions','action_audit_log','usage_tracking'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL',target);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(organization_id,user_id) REFERENCES organization_private.financial_scopes(organization_id,legacy_user_id)',target,target||'_organization_owner_fk');
    EXECUTE format('CREATE INDEX %I ON public.%I(organization_id)',target||'_organization_idx',target);
  END LOOP;
END $$;
ALTER TABLE public.actions ADD CONSTRAINT actions_organization_profile_fk FOREIGN KEY(organization_id,business_id,user_id)
  REFERENCES organization_private.financial_scopes(organization_id,legacy_business_profile_id,legacy_user_id);
ALTER TABLE public.actions ADD CONSTRAINT actions_organization_identity UNIQUE(id,organization_id,user_id);
ALTER TABLE public.action_audit_log ADD CONSTRAINT action_audit_organization_action_fk FOREIGN KEY(action_id,organization_id,user_id)
  REFERENCES public.actions(id,organization_id,user_id) ON DELETE CASCADE;
ALTER TABLE public.usage_tracking ADD CONSTRAINT usage_organization_period_key UNIQUE(organization_id,metric,period_start),
  ADD CONSTRAINT usage_nonnegative_count CHECK(count>=0), ADD CONSTRAINT usage_nonnegative_limit CHECK(usage_limit IS NULL OR usage_limit>=0),
  ADD CONSTRAINT usage_valid_period CHECK(period_end>period_start);
CREATE FUNCTION organization_private.guard_action_budget_ownership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scope organization_private.financial_scopes%ROWTYPE; parent_org uuid;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME NOT IN ('actions','action_audit_log','usage_tracking') OR TG_OP NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION 'Invalid action ownership trigger context'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Action/budget organization and legacy owner are immutable' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='actions' THEN
      IF NEW.business_id IS DISTINCT FROM OLD.business_id AND NOT(NEW.business_id IS NULL AND OLD.business_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_profiles WHERE id=OLD.business_id)) THEN
        RAISE EXCEPTION 'Action profile is immutable except deletion detachment' USING ERRCODE='23514'; END IF;
    ELSIF TG_TABLE_NAME='action_audit_log' THEN
      IF NEW.action_id IS DISTINCT FROM OLD.action_id THEN RAISE EXCEPTION 'Action history parent is immutable' USING ERRCODE='23514'; END IF;
    ELSE
      IF NEW.metric IS DISTINCT FROM OLD.metric OR NEW.period_start IS DISTINCT FROM OLD.period_start THEN
        RAISE EXCEPTION 'Usage period identity is immutable' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE
    IF TG_TABLE_NAME='action_audit_log' THEN
      SELECT a.organization_id INTO parent_org FROM public.actions a WHERE a.id=NEW.action_id AND a.user_id=NEW.user_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Matching action history parent required' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT s.* INTO scope FROM organization_private.financial_scopes s JOIN public.business_profiles p ON p.id=s.legacy_business_profile_id AND p.user_id=s.legacy_user_id
        JOIN public.legacy_account_organizations l ON l.organization_id=s.organization_id AND l.current_business_profile_id=p.id AND l.legacy_user_id=p.user_id AND l.state='live'
        JOIN public.organizations o ON o.id=s.organization_id AND o.lifecycle='active' WHERE s.legacy_user_id=NEW.user_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Live action/budget scope required' USING ERRCODE='55000'; END IF;
      parent_org:=scope.organization_id;
      IF TG_TABLE_NAME='actions' THEN
        IF NEW.business_id IS NOT NULL AND NEW.business_id<>scope.legacy_business_profile_id THEN RAISE EXCEPTION 'Foreign action profile' USING ERRCODE='23514'; END IF;
        NEW.business_id:=scope.legacy_business_profile_id;
      END IF;
    END IF;
    IF NEW.organization_id IS NOT NULL AND NEW.organization_id<>parent_org THEN RAISE EXCEPTION 'Foreign action/budget organization' USING ERRCODE='23514'; END IF;
    NEW.organization_id:=parent_org;
  END IF;
  IF TG_TABLE_NAME='actions' THEN
  IF NEW.linked_forecast_version_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.cash_forecast_versions v JOIN public.cash_forecasts f ON f.id=v.forecast_id
    JOIN organization_private.financial_scopes s ON s.organization_id=NEW.organization_id AND s.legacy_user_id=NEW.user_id
    WHERE v.id=NEW.linked_forecast_version_id AND v.user_id=NEW.user_id AND f.user_id=NEW.user_id AND f.business_id=s.legacy_business_profile_id) THEN
    RAISE EXCEPTION 'Foreign action forecast scope' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE target text; changed boolean; BEGIN
  FOREACH target IN ARRAY ARRAY['actions','action_audit_log','usage_tracking'] LOOP
    EXECUTE format('CREATE TRIGGER organization_action_budget_ownership BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION organization_private.guard_action_budget_ownership()',target);
    IF target='actions' THEN
      SELECT EXISTS(SELECT 1 FROM (SELECT * FROM d4b_before WHERE table_name='actions') b FULL JOIN public.actions a ON a.id=b.id
        WHERE a.id IS NULL OR b.id IS NULL OR to_jsonb(a)-'organization_id' IS DISTINCT FROM jsonb_set(b.row_value,'{business_id}',to_jsonb(b.expected_business))) INTO changed;
    ELSE
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM (SELECT id,row_value FROM d4b_before WHERE table_name=%L) b FULL JOIN public.%I a USING(id) WHERE a.id IS NULL OR b.id IS NULL OR to_jsonb(a)-''organization_id'' IS DISTINCT FROM b.row_value)',target,target) INTO changed;
    END IF;
    IF changed THEN RAISE EXCEPTION 'Preexisting action/history/usage fields changed outside reviewed scope'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM organization_private.action_scope_repairs)<>(SELECT count(*) FROM d4b_before WHERE table_name='actions' AND row_value->>'business_id' IS NULL) THEN
    RAISE EXCEPTION 'Action correction evidence mismatch'; END IF;
END $$;
REVOKE ALL ON FUNCTION organization_private.immutable_action_scope_repair(),organization_private.guard_action_budget_ownership() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE organization_private.action_scope_repairs IS 'D4B immutable administrative null-business correction evidence; no inferred historical actor, no application grants, retained after Auth/action deletion.';
COMMIT;
