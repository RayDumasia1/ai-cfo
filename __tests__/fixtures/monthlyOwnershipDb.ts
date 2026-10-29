import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { orgBootstrap, orgMigration, orgOwner, orgOther, orgProfile } from "./organizationDb";
export const ownershipMigration = () => readFileSync(new URL("../../docs/migrations/2026-10-29-organization-monthly-ownership.sql", import.meta.url), "utf8");
export async function monthlyOwnershipSetup(db: PGlite) {
  await db.exec(orgBootstrap);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
    ALTER TABLE public.business_profiles ADD COLUMN industry text, ADD COLUMN accounting_system text, ADD COLUMN employee_count integer,
      ADD COLUMN runway_warning_threshold numeric, ADD COLUMN runway_danger_threshold numeric, ADD COLUMN burn_rate_warning_pct numeric, ADD COLUMN invoice_overdue_days integer,
      ADD COLUMN snooze_duration text DEFAULT '24h';
    CREATE TABLE public.subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
      plan text,feature_tier text,status text,stripe_subscription_id text);
    INSERT INTO public.subscriptions(user_id,plan,feature_tier,status) VALUES('${orgOwner}','core','core','active'),('${orgOther}','growth','growth','active');
    CREATE TABLE public.financial_months(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,month_date date NOT NULL,opening_cash numeric,closing_cash numeric,
      total_revenue numeric,total_expenses numeric,payroll numeric,ar_outstanding numeric,ap_outstanding numeric,notes text,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,month_date));
    CREATE TRIGGER trg_financial_months_updated_at BEFORE UPDATE ON public.financial_months FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    CREATE TABLE public.expense_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      business_id uuid REFERENCES public.business_profiles(id) ON DELETE SET NULL,month_date date NOT NULL,category text NOT NULL,amount numeric NOT NULL,notes text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.data_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      import_type text NOT NULL,filename text,months_imported integer,status text NOT NULL,error_message text,created_at timestamptz DEFAULT now());
    ALTER TABLE public.financial_months ENABLE ROW LEVEL SECURITY; ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY; ALTER TABLE public.data_imports ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "financial_months: own rows" ON public.financial_months TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    CREATE POLICY categories_owner ON public.expense_categories TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    CREATE POLICY imports_owner ON public.data_imports TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
    GRANT SELECT ON public.financial_months,public.expense_categories TO authenticated;
    GRANT SELECT,INSERT ON public.data_imports TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.financial_months,public.expense_categories,public.data_imports TO service_role;`);
  // Execute the real installed migration chain, including compatibility aliases.
  for (const file of [
    "2026-10-23-atomic-financial-import.sql", "2026-10-23-atomic-financial-clear.sql", "2026-10-23-preserve-import-settings.sql",
    "2026-10-23-financial-revision-history.sql", "2026-10-23-financial-revision-version-text.sql", "2026-10-23-financial-import-modes.sql",
    "2026-10-24-preserve-settings-on-financial-clear.sql", "2026-10-24-financial-data-contract-v2.sql", "2026-10-24-reviewed-financial-import.sql",
    "2026-10-24-v2-financial-import.sql", "2026-10-25-idempotent-v2-financial-import.sql", "2026-10-25-review-unchanged-v2-import.sql",
  ]) await db.exec(readFileSync(new URL(`../../docs/migrations/${file}`, import.meta.url), "utf8"));
  await db.exec(orgMigration());
  for (const user of [orgOwner, orgOther]) await db.query("SELECT public.ensure_legacy_organization(id,user_id,$2) FROM public.business_profiles WHERE user_id=$1", [user, randomUUID()]);
  await db.exec(readFileSync(new URL("../../docs/migrations/2026-10-28-organization-owner-monthly-reads.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO public.financial_months(user_id,business_id,month_date,closing_cash,notes) VALUES($1,$2,'2026-08-01',0,'zero'),($1,$2,'2026-09-01',NULL,'unknown');
    `, [orgOwner, orgProfile]);
  await db.query("INSERT INTO public.expense_categories(user_id,business_id,month_date,category,amount) VALUES($1,$2,'2026-08-01','Payroll',0)", [orgOwner, orgProfile]);
  await db.query("INSERT INTO public.data_imports(user_id,import_type,filename,months_imported,status) VALUES($1,'csv','existing.csv',2,'success')", [orgOwner]);
  await db.query(`INSERT INTO public.financial_data_revisions(user_id,replaced_by_filename,profile_snapshot,months_snapshot,categories_snapshot)
    SELECT $1,'old.csv','{}',(SELECT jsonb_agg(to_jsonb(m)) FROM public.financial_months m),(SELECT jsonb_agg(to_jsonb(c)) FROM public.expense_categories c)`, [orgOwner]);
}
export const v2Month = { month_date: "2026-10-01", data_contract_version: 2, source_type: "spreadsheet", accounting_basis: "cash", reporting_currency: "USD", period_status: "complete",
  opening_included_cash: 1000, closing_included_cash: 1100, closing_unavailable_cash: 0, cash_collected_from_customers: 500, operating_cash_paid: 400,
  owner_draws_paid: 0, debt_principal_paid: 0, debt_interest_paid: 0, investing_cash_paid: 0, investing_cash_received: 0, debt_funding_received: 0,
  owner_funding_received: 0, other_cash_inflows: 0, other_cash_outflows: 0 };
