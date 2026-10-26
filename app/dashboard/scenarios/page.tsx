import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCashPosition, getFinancialMonths, getPublishedForecastDecisionContext, hasPaidSubscription } from "@/lib/db";
import { DASHBOARD_MONTH_LIMIT } from "@/lib/financialImportPolicy";
import { scenarioBaseline } from "@/lib/scenarioPlanning";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import { createClient } from "@/utils/supabase/server";
import ScenariosClient from "./ScenariosClient";
import { CASH_PLANNING_COPY } from "@/lib/cashPlanning";

export default async function ScenariosPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ forecast?: string; item?: string }>;
} = {}) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/auth?reason=session_expired");
  if (!hasVerifiedEmail(user)) redirect(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`);
  if (!(await hasPaidSubscription(user.id, supabase))) redirect("/welcome");
  const [cash, months, forecastContext] = await Promise.all([
    getCurrentCashPosition(user.id, supabase),
    getFinancialMonths(user.id, DASHBOARD_MONTH_LIMIT, supabase),
    query.forecast
      ? getPublishedForecastDecisionContext(user.id, query.forecast, supabase)
      : Promise.resolve(null),
  ]);
  const baseline = scenarioBaseline(cash?.cash ?? null, months);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <Link href="/dashboard/cash-planning" className="text-sm text-teal underline">Back to cash planning</Link>
      <div className="mb-8">
        <h1 className="mt-4 text-2xl font-medium text-ink">{CASH_PLANNING_COPY.decisionTest}</h1>
        <p className="mt-1 text-sm font-light text-dim">
          {CASH_PLANNING_COPY.decisionTestDescription}
        </p>
      </div>
      <ScenariosClient
        baseline={baseline}
        hasData={months.length > 0}
        forecastContext={forecastContext}
        suggestedItemId={query.item}
      />
    </div>
  );
}
