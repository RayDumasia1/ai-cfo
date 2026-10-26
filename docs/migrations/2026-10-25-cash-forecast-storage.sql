-- Apply in PREVIEW first. FORECAST-01C account-scoped forecast storage.
-- Published versions and their children are immutable. All writes are server-side.
BEGIN;

DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres';
  END IF;
END $$;

CREATE TABLE public.cash_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '13-week cash forecast' CHECK (length(name) BETWEEN 1 AND 120),
  reporting_currency text NOT NULL CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,user_id),
  UNIQUE(id,business_id,user_id)
);
CREATE UNIQUE INDEX cash_forecasts_one_active_per_account
  ON public.cash_forecasts(user_id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_cash_forecast_business_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_profiles b WHERE b.id=NEW.business_id AND b.user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Forecast business does not belong to account' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_forecasts_business_owner
  BEFORE INSERT OR UPDATE OF business_id,user_id ON public.cash_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_business_owner();

CREATE OR REPLACE FUNCTION public.guard_cash_forecast_deletion()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Preserve forecast history during ordinary operations. Auth account deletion
  -- is the only hard-delete path and cascades through every forecast table.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id=OLD.user_id) THEN
    RAISE EXCEPTION 'Archive forecasts instead of deleting them' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER cash_forecasts_no_direct_delete
  BEFORE DELETE ON public.cash_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_deletion();

CREATE TABLE public.cash_forecast_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  case_type text NOT NULL DEFAULT 'base' CHECK (case_type IN ('base','downside','upside')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded','archived')),
  parent_version_id uuid,
  as_of_date date NOT NULL,
  start_date date NOT NULL,
  starting_included_cash numeric(20,4) NOT NULL CHECK (starting_included_cash >= 0),
  starting_unavailable_cash numeric(20,4) NOT NULL DEFAULT 0 CHECK (starting_unavailable_cash >= 0),
  minimum_reserve numeric(20,4) NOT NULL DEFAULT 0 CHECK (minimum_reserve >= 0),
  source_data_version text CHECK (source_data_version IS NULL OR length(source_data_version) <= 200),
  formula_policy_version text NOT NULL CHECK (length(formula_policy_version) BETWEEN 1 AND 80),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_snapshot)='object' AND pg_column_size(source_snapshot) <= 262144),
  calculation_result jsonb
    CHECK (calculation_result IS NULL OR (jsonb_typeof(calculation_result)='object' AND pg_column_size(calculation_result) <= 524288)),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(forecast_id,user_id) REFERENCES public.cash_forecasts(id,user_id) ON DELETE CASCADE,
  UNIQUE(forecast_id,version_number),
  UNIQUE(id,user_id),
  UNIQUE(id,forecast_id,user_id),
  CHECK (start_date >= as_of_date),
  CHECK ((status IN ('published','superseded') AND calculation_result IS NOT NULL AND published_at IS NOT NULL AND published_by IS NOT NULL)
      OR status IN ('draft','archived'))
);
ALTER TABLE public.cash_forecast_versions ADD CONSTRAINT cash_forecast_versions_parent_fk
  FOREIGN KEY(parent_version_id,forecast_id,user_id)
  REFERENCES public.cash_forecast_versions(id,forecast_id,user_id);
CREATE UNIQUE INDEX cash_forecast_versions_one_published_case
  ON public.cash_forecast_versions(forecast_id,case_type) WHERE status='published';

CREATE TABLE public.cash_forecast_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  cadence text NOT NULL CHECK (cadence IN ('weekly','biweekly','semimonthly','monthly','quarterly','custom')),
  direction text NOT NULL CHECK (direction IN ('inflow','outflow')),
  category text NOT NULL CHECK (category IN ('customer_receipt','operating_vendor_payment','payroll','tax','debt_principal','debt_interest','owner_distribution','asset_purchase','asset_proceeds','new_debt','owner_equity_funding','other_cash_in','other_cash_out')),
  amount numeric(20,4) CHECK (amount IS NULL OR amount >= 0),
  starts_on date NOT NULL,
  ends_on date,
  recurrence_rule text CHECK (recurrence_rule IS NULL OR length(recurrence_rule) <= 500),
  source_type text NOT NULL CHECK (source_type IN ('manual','spreadsheet','quickbooks','banking','other_provider','system')),
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) <= 500),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(version_id,user_id) REFERENCES public.cash_forecast_versions(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,version_id,user_id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE public.cash_forecast_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_id uuid,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  counterparty text CHECK (counterparty IS NULL OR length(counterparty) <= 300),
  amount numeric(20,4) CHECK (amount IS NULL OR amount >= 0),
  direction text NOT NULL CHECK (direction IN ('inflow','outflow')),
  category text NOT NULL CHECK (category IN ('customer_receipt','operating_vendor_payment','payroll','tax','debt_principal','debt_interest','owner_distribution','asset_purchase','asset_proceeds','new_debt','owner_equity_funding','other_cash_in','other_cash_out')),
  expected_date date,
  status text NOT NULL CHECK (status IN ('expected','confirmed','paid','received','cancelled','excluded')),
  confidence text NOT NULL CHECK (confidence IN ('confirmed','high','medium','low','unknown')),
  amount_is_estimated boolean NOT NULL DEFAULT false,
  date_is_estimated boolean NOT NULL DEFAULT false,
  zero_confirmed boolean NOT NULL DEFAULT false,
  source_type text NOT NULL CHECK (source_type IN ('manual','spreadsheet','quickbooks','banking','other_provider','system')),
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) <= 500),
  source_updated_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence)='object' AND pg_column_size(evidence) <= 131072),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(version_id,user_id) REFERENCES public.cash_forecast_versions(id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(schedule_id,version_id,user_id) REFERENCES public.cash_forecast_schedules(id,version_id,user_id),
  UNIQUE(version_id,item_key),
  UNIQUE(id,version_id,user_id),
  CHECK ((amount IS NULL AND NOT zero_confirmed) OR (amount IS NOT NULL)),
  CHECK (NOT zero_confirmed OR amount = 0),
  CHECK ((direction='inflow' AND category IN ('customer_receipt','asset_proceeds','new_debt','owner_equity_funding','other_cash_in'))
      OR (direction='outflow' AND category IN ('operating_vendor_payment','payroll','tax','debt_principal','debt_interest','owner_distribution','asset_purchase','other_cash_out')))
);

CREATE TABLE public.cash_forecast_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  operation text NOT NULL CHECK (operation IN ('amount_multiplier','date_shift_days','exclude')),
  numeric_value numeric(20,6),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(version_id,user_id) REFERENCES public.cash_forecast_versions(id,user_id) ON DELETE CASCADE,
  UNIQUE(id,version_id,user_id),
  CHECK ((operation='exclude' AND numeric_value IS NULL)
      OR (operation='amount_multiplier' AND numeric_value IS NOT NULL AND numeric_value >= 0)
      OR (operation='date_shift_days' AND numeric_value IS NOT NULL AND numeric_value=trunc(numeric_value) AND numeric_value BETWEEN -365 AND 365))
);

CREATE TABLE public.cash_forecast_assumption_items (
  assumption_id uuid NOT NULL,
  item_id uuid NOT NULL,
  version_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY(assumption_id,item_id),
  FOREIGN KEY(assumption_id,version_id,user_id) REFERENCES public.cash_forecast_assumptions(id,version_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(item_id,version_id,user_id) REFERENCES public.cash_forecast_items(id,version_id,user_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.guard_cash_forecast_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status IN ('published','superseded')
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id=OLD.user_id) THEN
    RAISE EXCEPTION 'Published forecast versions are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('published','superseded') THEN
    IF OLD.status='published' AND NEW.status='superseded'
       AND (to_jsonb(NEW)-ARRAY['status','superseded_at','updated_at'])
           = (to_jsonb(OLD)-ARRAY['status','superseded_at','updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Published forecast versions are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_forecast_versions_immutable
  BEFORE UPDATE OR DELETE ON public.cash_forecast_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_version_immutability();

CREATE OR REPLACE FUNCTION public.guard_cash_forecast_child_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_version_id uuid; v_status text;
BEGIN
  IF TG_OP='DELETE' THEN v_version_id:=OLD.version_id; ELSE v_version_id:=NEW.version_id; END IF;
  SELECT status INTO v_status FROM public.cash_forecast_versions WHERE id=v_version_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft forecast versions may be changed' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_forecast_schedules_draft_only BEFORE INSERT OR UPDATE OR DELETE ON public.cash_forecast_schedules FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_child_mutation();
CREATE TRIGGER cash_forecast_items_draft_only BEFORE INSERT OR UPDATE OR DELETE ON public.cash_forecast_items FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_child_mutation();
CREATE TRIGGER cash_forecast_assumptions_draft_only BEFORE INSERT OR UPDATE OR DELETE ON public.cash_forecast_assumptions FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_child_mutation();
CREATE TRIGGER cash_forecast_assumption_items_draft_only BEFORE INSERT OR UPDATE OR DELETE ON public.cash_forecast_assumption_items FOR EACH ROW EXECUTE FUNCTION public.guard_cash_forecast_child_mutation();

CREATE OR REPLACE FUNCTION public.touch_cash_forecast_draft()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_version_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN v_version_id:=OLD.version_id; ELSE v_version_id:=NEW.version_id; END IF;
  UPDATE public.cash_forecast_versions SET updated_at=clock_timestamp() WHERE id=v_version_id AND status='draft';
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_forecast_schedules_touch AFTER INSERT OR UPDATE OR DELETE ON public.cash_forecast_schedules FOR EACH ROW EXECUTE FUNCTION public.touch_cash_forecast_draft();
CREATE TRIGGER cash_forecast_items_touch AFTER INSERT OR UPDATE OR DELETE ON public.cash_forecast_items FOR EACH ROW EXECUTE FUNCTION public.touch_cash_forecast_draft();
CREATE TRIGGER cash_forecast_assumptions_touch AFTER INSERT OR UPDATE OR DELETE ON public.cash_forecast_assumptions FOR EACH ROW EXECUTE FUNCTION public.touch_cash_forecast_draft();
CREATE TRIGGER cash_forecast_assumption_items_touch AFTER INSERT OR UPDATE OR DELETE ON public.cash_forecast_assumption_items FOR EACH ROW EXECUTE FUNCTION public.touch_cash_forecast_draft();

CREATE OR REPLACE FUNCTION public.begin_cash_forecast_draft(
  p_user_id uuid,p_business_id uuid,p_reporting_currency text,p_as_of_date date,p_start_date date,
  p_starting_included_cash numeric,p_starting_unavailable_cash numeric,p_minimum_reserve numeric,
  p_source_data_version text,p_formula_policy_version text,p_source_snapshot jsonb,p_parent_version_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_forecast_id uuid; v_version_id uuid; v_version_number integer; v_now timestamptz:=clock_timestamp();
BEGIN
  PERFORM 1 FROM public.business_profiles WHERE id=p_business_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business profile not found' USING ERRCODE='P0002'; END IF;
  IF p_reporting_currency !~ '^[A-Z]{3}$' OR p_start_date<p_as_of_date
     OR p_starting_included_cash<0 OR p_starting_unavailable_cash<0 OR p_minimum_reserve<0
     OR p_formula_policy_version IS NULL OR length(p_formula_policy_version) NOT BETWEEN 1 AND 80
     OR p_source_snapshot IS NULL OR jsonb_typeof(p_source_snapshot)<>'object' OR pg_column_size(p_source_snapshot)>262144 THEN
    RAISE EXCEPTION 'Invalid forecast draft inputs' USING ERRCODE='22023';
  END IF;
  SELECT id INTO v_forecast_id FROM public.cash_forecasts WHERE user_id=p_user_id AND archived_at IS NULL FOR UPDATE;
  IF v_forecast_id IS NULL THEN
    INSERT INTO public.cash_forecasts(user_id,business_id,reporting_currency,created_at,updated_at)
      VALUES(p_user_id,p_business_id,p_reporting_currency,v_now,v_now) RETURNING id INTO v_forecast_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.cash_forecasts WHERE id=v_forecast_id AND business_id=p_business_id AND reporting_currency=p_reporting_currency) THEN
      RAISE EXCEPTION 'Active forecast business or currency differs' USING ERRCODE='23514';
    END IF;
  END IF;
  IF p_parent_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_forecast_versions WHERE id=p_parent_version_id AND forecast_id=v_forecast_id AND user_id=p_user_id AND status IN ('published','superseded')
  ) THEN RAISE EXCEPTION 'Parent forecast version not found' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(max(version_number),0)+1 INTO v_version_number FROM public.cash_forecast_versions WHERE forecast_id=v_forecast_id;
  INSERT INTO public.cash_forecast_versions(
    forecast_id,user_id,version_number,parent_version_id,as_of_date,start_date,starting_included_cash,
    starting_unavailable_cash,minimum_reserve,source_data_version,formula_policy_version,source_snapshot,created_by,created_at,updated_at
  ) VALUES(
    v_forecast_id,p_user_id,v_version_number,p_parent_version_id,p_as_of_date,p_start_date,p_starting_included_cash,
    p_starting_unavailable_cash,p_minimum_reserve,p_source_data_version,p_formula_policy_version,p_source_snapshot,p_user_id,v_now,v_now
  ) RETURNING id INTO v_version_id;
  RETURN jsonb_build_object('forecast_id',v_forecast_id,'version_id',v_version_id,'version_number',v_version_number,'status','draft','updated_at',v_now);
END $$;

CREATE OR REPLACE FUNCTION public.publish_cash_forecast_version(
  p_user_id uuid,p_forecast_id uuid,p_version_id uuid,p_calculation_result jsonb,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_version public.cash_forecast_versions%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_calculation_result IS NULL OR jsonb_typeof(p_calculation_result)<>'object' OR pg_column_size(p_calculation_result)>524288 THEN
    RAISE EXCEPTION 'Invalid calculation result' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.cash_forecasts WHERE id=p_forecast_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forecast not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_version FROM public.cash_forecast_versions
    WHERE id=p_version_id AND forecast_id=p_forecast_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forecast version not found' USING ERRCODE='P0002'; END IF;
  IF v_version.status<>'draft' THEN RAISE EXCEPTION 'Only a draft may be published' USING ERRCODE='55000'; END IF;
  IF v_version.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Forecast draft changed; reload before publishing' USING ERRCODE='40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_forecast_items i WHERE i.version_id=p_version_id
             AND i.status NOT IN ('cancelled','excluded') AND (i.amount IS NULL OR i.expected_date IS NULL)) THEN
    RAISE EXCEPTION 'Resolve missing active item amounts and dates before publishing' USING ERRCODE='23514';
  END IF;
  UPDATE public.cash_forecast_versions SET status='superseded',superseded_at=v_now,updated_at=v_now
    WHERE forecast_id=p_forecast_id AND case_type=v_version.case_type AND status='published';
  UPDATE public.cash_forecast_versions SET status='published',calculation_result=p_calculation_result,
    published_by=p_user_id,published_at=v_now,updated_at=v_now WHERE id=p_version_id;
  RETURN jsonb_build_object('forecast_id',p_forecast_id,'version_id',p_version_id,'version_number',v_version.version_number,'status','published','published_at',v_now);
END $$;

ALTER TABLE public.cash_forecasts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecasts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecast_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecast_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecast_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_assumptions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecast_assumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_forecast_assumption_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cash_forecast_assumption_items FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_forecasts_owner_read ON public.cash_forecasts FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY cash_forecast_versions_owner_read ON public.cash_forecast_versions FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY cash_forecast_schedules_owner_read ON public.cash_forecast_schedules FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY cash_forecast_items_owner_read ON public.cash_forecast_items FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY cash_forecast_assumptions_owner_read ON public.cash_forecast_assumptions FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY cash_forecast_assumption_items_owner_read ON public.cash_forecast_assumption_items FOR SELECT TO authenticated USING (auth.uid()=user_id);

REVOKE ALL ON public.cash_forecasts,public.cash_forecast_versions,public.cash_forecast_schedules,public.cash_forecast_items,public.cash_forecast_assumptions,public.cash_forecast_assumption_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.cash_forecasts,public.cash_forecast_versions,public.cash_forecast_schedules,public.cash_forecast_items,public.cash_forecast_assumptions,public.cash_forecast_assumption_items TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cash_forecasts,public.cash_forecast_versions,public.cash_forecast_schedules,public.cash_forecast_items,public.cash_forecast_assumptions,public.cash_forecast_assumption_items TO service_role;
REVOKE ALL ON FUNCTION public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_cash_forecast_version(uuid,uuid,uuid,jsonb,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.begin_cash_forecast_draft(uuid,uuid,text,date,date,numeric,numeric,numeric,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_cash_forecast_draft(uuid,uuid,text,date,date,numeric,numeric,numeric,text,text,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_cash_forecast_business_owner(),public.guard_cash_forecast_deletion(),public.guard_cash_forecast_version_immutability(),public.guard_cash_forecast_child_mutation(),public.touch_cash_forecast_draft() FROM PUBLIC,anon,authenticated;

COMMIT;
