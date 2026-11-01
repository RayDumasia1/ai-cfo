import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { monthlyOwnershipSetup,ownershipMigration } from "./monthlyOwnershipDb";
import { orgOwner,orgOther,orgOtherProfile } from "./organizationDb";
export const actionMigration=()=>readFileSync(new URL('../../docs/migrations/2026-10-31-organization-action-ownership.sql',import.meta.url),'utf8');
const sql=(file:string)=>readFileSync(new URL(`../../docs/migrations/${file}`,import.meta.url),'utf8');
export const seedAction='30000000-0000-4000-8000-000000000001';
export async function actionOwnershipSetup(db:PGlite){
  await monthlyOwnershipSetup(db);await db.exec(ownershipMigration());await db.exec(sql('2026-10-29-organization-monthly-write-authority.sql'));
  // Reconstructed base tables: their original dashboard schema predates repo
  // migrations. Execute the actual action/capacity/forecast/usage RPC chain below.
  await db.exec(`CREATE TABLE public.actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),description text,
    goal_type text NOT NULL CHECK(goal_type IN('revenue_increase','expense_reduction','runway_improvement','risk_mitigation')),
    goal_value numeric(15,2),goal_unit text,status text NOT NULL DEFAULT 'not_started' CHECK(status IN('not_started','in_progress','completed')),
    due_date date,linked_alert_code text,actual_impact numeric(15,2),actual_impact_notes text,completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.action_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action_id uuid NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,old_status text,new_status text NOT NULL,note text,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.usage_tracking(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),metric text NOT NULL
      CHECK(metric IN('ask_cfo_questions','ai_insight_runs','actions_created')),period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,
      count integer NOT NULL DEFAULT 0,usage_limit integer,warning_sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,metric,period_start));
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
    CREATE FUNCTION public.actions_set_completed_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN NEW.completed_at = now(); END IF;
      IF NEW.status <> 'completed' THEN NEW.completed_at = NULL; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER actions_set_updated_at BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    CREATE TRIGGER actions_completed_at_trigger BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.actions_set_completed_at();
    ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
    CREATE POLICY action_owner ON public.actions TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    CREATE POLICY audit_owner ON public.action_audit_log TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    CREATE POLICY usage_owner ON public.usage_tracking FOR SELECT TO authenticated USING(auth.uid()=user_id);
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.actions TO authenticated,service_role;
    GRANT SELECT,INSERT ON public.action_audit_log TO authenticated;GRANT SELECT ON public.usage_tracking TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.action_audit_log,public.usage_tracking TO service_role;
    CREATE FUNCTION public.increment_usage(uuid,text,timestamptz,timestamptz,integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Retired'; END $$;
    REVOKE ALL ON FUNCTION public.increment_usage(uuid,text,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;`);
  for(const file of ['2026-10-23-action-capacity-guard.sql','2026-10-23-atomic-action-update.sql','2026-10-25-cash-forecast-storage.sql',
    '2026-10-25-forecast-action-links.sql','2026-10-26-discard-cash-forecast-draft.sql','2026-10-25-atomic-usage-consumption.sql'])await db.exec(sql(file));
  await db.query(`INSERT INTO public.actions(id,user_id,name,goal_type,status,completed_at,created_at,updated_at) VALUES($1,$2,'Old active','risk_mitigation','in_progress','2026-09-01 00:00:00.123456+00','2026-08-01','2026-09-01')`,[seedAction,orgOwner]);
  await db.query("INSERT INTO public.actions(user_id,name,goal_type,status) VALUES($1,'Old completed','runway_improvement','completed')",[orgOwner]);
  await db.query("INSERT INTO public.actions(user_id,business_id,name,goal_type,status) VALUES($1,$2,'Foreign owner','risk_mitigation','not_started')",[orgOther,orgOtherProfile]);
  await db.query("INSERT INTO public.action_audit_log(action_id,user_id,old_status,new_status,note,created_at) VALUES($1,$2,'not_started','in_progress','Keep original note','2026-09-01 00:00:00.123456+00')",[seedAction,orgOwner]);
  await db.query(`INSERT INTO public.usage_tracking(user_id,metric,period_start,period_end,count,usage_limit,warning_sent_at,created_at,updated_at) VALUES
    ($1,'ask_cfo_questions','2026-10-15','2026-11-15',19,20,'2026-10-20 00:00:00.123456+00','2026-10-15','2026-10-20'),
    ($1,'actions_created','2026-10-15','2026-11-15',8,NULL,NULL,'2026-10-15','2026-10-20'),
    ($2,'ai_insight_runs','2026-10-15','2026-11-15',0,3,NULL,'2026-10-15','2026-10-15')`,[orgOwner,orgOther]);
}
