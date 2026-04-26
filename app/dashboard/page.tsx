import { createClient } from "@/utils/supabase/server";
import {
  getCurrentCashPosition,
  getOrCreateBusinessProfile,
  getFinancialMonths,
  getDismissedAlerts,
} from "@/lib/db";
import { alertEngine, isAlertSnoozed } from "@/lib/calculations";
import DashboardLayout from "@/app/components/DashboardLayout";
import CashPositionCard from "@/app/components/CashPositionCard";
import BurnRateCard from "@/app/components/BurnRateCard";
import RunwayCard from "@/app/components/RunwayCard";
import CashOutCard from "@/app/components/CashOutCard";
import ScenarioPanel from "@/app/components/ScenarioPanel";
import TopAlerts from "@/app/components/TopAlerts";
import BottomAlerts from "@/app/components/BottomAlerts";
import RevenueBurnChart from "@/app/components/RevenueBurnChart";
import ImportRefresher from "./ImportRefresher";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [cashPosition, profile, recentMonths, dismissedAlerts] = await Promise.all([
    user ? getCurrentCashPosition(user.id, supabase) : null,
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    user ? getFinancialMonths(user.id, 6, supabase) : [],
    user ? getDismissedAlerts(user.id, supabase) : [],
  ]);

  // data_version lives on business_profiles — null until first import.
  const dataVersion = profile?.data_version ?? null;

  // User's snooze preference — used for tooltip text in DismissibleAlert.
  const snoozeDuration = profile?.snooze_duration ?? "24h";

  // Run alertEngine once, then filter out snoozed alerts.
  const allAlerts =
    profile && recentMonths.length > 0
      ? alertEngine(recentMonths, profile)
      : [];

  const visibleAlerts = allAlerts.filter(
    (alert) => !isAlertSnoozed(alert.code, dismissedAlerts ?? [], dataVersion)
  );

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
        <TopAlerts
          alerts={visibleAlerts}
          dismissedAlerts={dismissedAlerts ?? []}
          dataVersion={dataVersion}
          snoozeDuration={snoozeDuration}
        />

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
          <BottomAlerts
            alerts={visibleAlerts}
            dismissedAlerts={dismissedAlerts ?? []}
            dataVersion={dataVersion}
            snoozeDuration={snoozeDuration}
          />
        </div>

        {/* Two-column bottom row: Import | Scenario */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div id="import-section">
            <h2 className="text-base font-medium text-ink mb-3">
              Import Financial Data
            </h2>
            <ImportRefresher hasData={recentMonths.length > 0} />
          </div>

          <ScenarioPanel hasData={recentMonths.length > 0} />
        </div>

      </div>
    </DashboardLayout>
  );
}
