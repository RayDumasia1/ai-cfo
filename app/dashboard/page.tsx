import { createClient } from "@/utils/supabase/server";
import {
  getCurrentCashPosition,
  getOrCreateBusinessProfile,
  getFinancialMonths,
  getDismissedAlerts,
  getSubscription,
} from "@/lib/db";
import { alertEngine, isAlertSnoozed, currentRunway } from "@/lib/calculations";
import { isNewUser as isNewUserCheck, parseSuperuserEmails } from "@/lib/onboarding";
import CashPositionCard from "@/app/components/CashPositionCard";
import BurnRateCard from "@/app/components/BurnRateCard";
import RunwayCard from "@/app/components/RunwayCard";
import CashOutCard from "@/app/components/CashOutCard";
import ScenarioPanel from "@/app/components/ScenarioPanel";
import TopAlerts from "@/app/components/TopAlerts";
import BottomAlerts from "@/app/components/BottomAlerts";
import RevenueBurnChart from "@/app/components/RevenueBurnChart";
import ImportRefresher from "./ImportRefresher";
import OnboardingController from "./OnboardingController";
import UpgradeStrip from "@/app/components/billing/UpgradeStrip";
import CheckoutSuccessBanner from "@/app/components/billing/CheckoutSuccessBanner";
import FoundingMemberWelcomeBanner from "@/app/components/billing/FoundingMemberWelcomeBanner";
import PendingCancellationBanner from "@/app/components/billing/PendingCancellationBanner";
import SubscriptionEndedBanner from "@/app/components/billing/SubscriptionEndedBanner";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const params = await searchParams;
  const checkoutSuccess = params.checkout === "success";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [cashPosition, profile, recentMonths, dismissedAlerts, subscription] = await Promise.all([
    user ? getCurrentCashPosition(user.id, supabase) : null,
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    user ? getFinancialMonths(user.id, 6, supabase) : [],
    user ? getDismissedAlerts(user.id, supabase) : [],
    user ? getSubscription(user.id, supabase) : null,
  ]);

  const dataVersion = profile?.data_version ?? null;
  const snoozeDuration = profile?.snooze_duration ?? "24h";

  const allAlerts =
    profile && recentMonths.length > 0
      ? alertEngine(recentMonths, profile)
      : [];

  const visibleAlerts = allAlerts.filter(
    (alert) => !isAlertSnoozed(alert.code, dismissedAlerts ?? [], dataVersion)
  );

  const isNewUser = isNewUserCheck({
    monthsCount: recentMonths.length,
    onboardingCompletedAt: profile?.onboarding_completed_at,
    email: user?.email,
    superuserEmails: parseSuperuserEmails(process.env.SUPERUSER_EMAILS),
  });

  const calculatedRunway = currentRunway(
    cashPosition?.cash ?? null,
    recentMonths.map((m) => m.total_expenses)
  );

  const isFoundingMember = subscription?.plan === "founding_member";
  const isActiveFM = isFoundingMember && subscription?.status === "active";
  const isPendingCancellationFM =
    isFoundingMember && subscription?.status === "pending_cancellation";

  if (subscription?.feature_tier === "suspended") {
    return (
      <SubscriptionEndedBanner memberNumber={subscription.founding_member_number} />
    );
  }

  const successMessage =
    checkoutSuccess && isActiveFM && subscription?.founding_member_number
      ? `🎉 Welcome, Founding Member #${subscription.founding_member_number}! Your Core features are now active.`
      : undefined;

  return (
    <div className="px-8 py-8">
      {/* Founding Member welcome banner — dismissible, shown until localStorage dismiss */}
      {isActiveFM && subscription.founding_member_number && (
        <FoundingMemberWelcomeBanner
          memberNumber={subscription.founding_member_number}
          userId={user!.id}
        />
      )}

      {/* Pending cancellation banner — subscription cancelled at period end, billing still active */}
      {isPendingCancellationFM && subscription.billing_period_end && (
        <PendingCancellationBanner
          memberNumber={subscription.founding_member_number ?? 1}
          billingPeriodEnd={subscription.billing_period_end}
        />
      )}

      {/* Checkout success banner — above page header, auto-dismisses after 5s */}
      <CheckoutSuccessBanner show={checkoutSuccess} message={successMessage} />

      {/* Onboarding — welcome banner, setup modal, post-import celebration */}
      <OnboardingController
        isNewUser={isNewUser}
        businessName={profile?.business_name ?? null}
        currentRunway={calculatedRunway}
      />

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-ink">Dashboard</h1>
        <p className="mt-1 text-sm font-light text-dim">
          {profile?.business_name
            ? `${profile.business_name} · Financial snapshot`
            : "Your financial snapshot at a glance."}
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
      <div className="mb-8" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, alignItems: "stretch" }}>
        <CashPositionCard
          initialData={cashPosition}
          minCashReserve={profile?.min_cash_reserve}
          isNewUser={isNewUser}
        />
        <BurnRateCard months={recentMonths ?? []} isNewUser={isNewUser} />
        <RunwayCard
          cash={cashPosition?.cash ?? null}
          months={recentMonths ?? []}
          runwayWarningThreshold={profile?.runway_warning_threshold}
          isNewUser={isNewUser}
        />
        <CashOutCard
          cash={cashPosition?.cash ?? null}
          months={recentMonths ?? []}
          isNewUser={isNewUser}
        />
      </div>

      {/* Revenue vs Burn chart — always rendered; component handles empty state */}
      <div className="mb-8">
        <RevenueBurnChart months={recentMonths} />
      </div>

      {/* Bottom alerts — success only, or "everything healthy" when zero total */}
      <div className="mb-8">
        <BottomAlerts
          alerts={visibleAlerts}
          dismissedAlerts={dismissedAlerts ?? []}
          dataVersion={dataVersion}
          snoozeDuration={snoozeDuration}
        />
      </div>

      {/* Two-column data row: Import | What-If Scenario */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div id="import-section">
          <ImportRefresher hasData={recentMonths.length > 0} isNewUser={isNewUser} />
        </div>

        <ScenarioPanel hasData={recentMonths.length > 0} />
      </div>

      {/* Upgrade strip — Starter only */}
      {subscription && (
        <UpgradeStrip currentTier={subscription.feature_tier} />
      )}
    </div>
  );
}
