import { createClient } from "@/utils/supabase/server";
import {
  getCurrentCashPosition,
  getOrCreateBusinessProfile,
  getFinancialMonths,
} from "@/lib/db";
import DashboardLayout from "@/app/components/DashboardLayout";
import CashPositionCard from "@/app/components/CashPositionCard";
import BurnRateCard from "@/app/components/BurnRateCard";
import RunwayCard from "@/app/components/RunwayCard";
import CashOutCard from "@/app/components/CashOutCard";
import ManualCalculator from "@/app/components/ManualCalculator";
import AlertsPanel from "@/app/components/AlertsPanel";
import ImportRefresher from "./ImportRefresher";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [cashPosition, profile, recentMonths] = await Promise.all([
    user ? getCurrentCashPosition(user.id, supabase) : null,
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    user ? getFinancialMonths(user.id, 3, supabase) : [],
  ]);

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

        {/* Import uploader */}
        <div className="mb-8 max-w-lg">
          <h2 className="text-base font-medium text-ink mb-3">
            Import Financial Data
          </h2>
          <ImportRefresher />
        </div>

        {/* Alerts */}
        {profile && recentMonths.length > 0 && (
          <div className="mb-8 max-w-2xl">
            <h2 className="text-base font-medium text-ink mb-3">Alerts</h2>
            <AlertsPanel months={recentMonths} profile={profile} />
          </div>
        )}

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
