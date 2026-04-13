import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentCashPosition,
  getOrCreateBusinessProfile,
} from "@/lib/db";
import DashboardLayout from "@/app/components/DashboardLayout";
import CashPositionCard from "@/app/components/CashPositionCard";
import StatCard from "@/app/components/StatCard";
import ManualCalculator from "@/app/components/ManualCalculator";
import ImportRefresher from "./ImportRefresher";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [cashPosition, profile] = await Promise.all([
    user ? getCurrentCashPosition(user.id, supabase) : null,
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
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
          <StatCard label="Monthly Burn" value="—" subtext="Import data to calculate" />
          <StatCard label="Runway" value="—" subtext="Import data to calculate" />
          <StatCard label="Cash-Out Date" value="—" highlight />
        </div>

        {/* Import uploader */}
        <div className="mb-8 max-w-lg">
          <h2 className="text-base font-medium text-ink mb-3">
            Import Financial Data
          </h2>
          <ImportRefresher />
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
