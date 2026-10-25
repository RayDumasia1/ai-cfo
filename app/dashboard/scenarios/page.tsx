import ManualCalculator from "@/app/components/ManualCalculator";
import { getCurrentCashPosition, getFinancialMonths } from "@/lib/db";
import { DASHBOARD_MONTH_LIMIT } from "@/lib/financialImportPolicy";
import { scenarioBaseline } from "@/lib/scenarioPlanning";
import { createClient } from "@/utils/supabase/server";

export default async function ScenariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [cash, months] = user ? await Promise.all([
    getCurrentCashPosition(user.id, supabase),
    getFinancialMonths(user.id, DASHBOARD_MONTH_LIMIT, supabase),
  ]) : [null, []];
  const baseline = scenarioBaseline(cash?.cash ?? null, months);
  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-ink">What-If Scenarios</h1>
        <p className="mt-1 text-sm font-light text-dim">
          Model financial scenarios to plan ahead and stress-test your numbers.
        </p>
      </div>

      <ManualCalculator baseline={baseline} hasData={months.length > 0} />
    </div>
  );
}
