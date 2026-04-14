import { createClient } from "@/utils/supabase/server";
import {
  getCurrentCashPosition,
  getOrCreateBusinessProfile,
  getFinancialMonths,
} from "@/lib/db";
import { alertEngine } from "@/lib/calculations";
import DashboardLayout from "@/app/components/DashboardLayout";
import CashPositionCard from "@/app/components/CashPositionCard";
import BurnRateCard from "@/app/components/BurnRateCard";
import RunwayCard from "@/app/components/RunwayCard";
import CashOutCard from "@/app/components/CashOutCard";
import ManualCalculator from "@/app/components/ManualCalculator";
import TopAlerts from "@/app/components/TopAlerts";
import BottomAlerts from "@/app/components/BottomAlerts";
import RevenueBurnChart from "@/app/components/RevenueBurnChart";
import ImportRefresher from "./ImportRefresher";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [cashPosition, profile, recentMonths] = await Promise.all([
    user ? getCurrentCashPosition(user.id, supabase) : null,
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    user ? getFinancialMonths(user.id, 6, supabase) : [],
  ]);

  // Run alertEngine once — both alert components receive the same array.
  const alerts =
    profile && recentMonths.length > 0
      ? alertEngine(recentMonths, profile)
      : [];

  return (
    <DashboardLayout>
      <div className="px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-medium text-ink">Dashboard</h1>
          <p className="mt-1 text-sm font-light text-dim">
            Your financial snapshot at a glance.
          </p>
        </div>

        {/* Top alerts — danger + warning only; renders nothing when all clear */}
        <TopAlerts alerts={alerts} />

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
          <CashPositionCard
            initialData={cashPosition}
            minCashReserve={profile?.min_cash_reserve}
          />
          <BurnRateCard months={recentMonths ?? []} />
          <RunwayCard
            cash={cashPosition?.cash ?? null}
            months={recentMonths ?? []}
            runwayWarningThreshold={profile?.runway_warning_threshold}
          />
          <CashOutCard cash={cashPosition?.cash ?? null} months={recentMonths ?? []} />
        </div>

        {/* Revenue vs Burn chart — always rendered; component handles empty state */}
        <div className="mb-8">
          <RevenueBurnChart months={recentMonths} />
        </div>

        {/* Bottom alerts — success only, or "everything healthy" when zero total */}
        <div className="mb-8 max-w-2xl">
          <BottomAlerts alerts={alerts} />
        </div>

        {/* Import uploader */}
        <div id="import-section" className="mb-8 max-w-lg">
          <h2 className="text-base font-medium text-ink mb-3">
            Import Financial Data
          </h2>
          <ImportRefresher hasData={recentMonths.length > 0} />
        </div>

        {/* Manual scenario calculator */}
        <div>
          <h2 className="text-base font-medium text-ink mb-3">
            Manual Scenario
          </h2>
          <ManualCalculator />
        </div>
      </div>
    </DashboardLayout>
  );
}
