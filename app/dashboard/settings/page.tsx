import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getOrCreateBusinessProfile, getBillingDetails } from "@/lib/db";
import AlertPreferencesCard from "@/app/components/settings/AlertPreferencesCard";
import ThresholdsCard from "@/app/components/settings/ThresholdsCard";
import ChangePasswordCard from "@/app/components/settings/ChangePasswordCard";
import AccountCard from "@/app/components/settings/AccountCard";
import PrivacyLegalCard from "@/app/components/settings/PrivacyLegalCard";
import CurrentPlanCard from "@/app/components/billing/CurrentPlanCard";
import UsageCard from "@/app/components/billing/UsageCard";
import PlanComparisonCard from "@/app/components/billing/PlanComparisonCard";
import BillingHistoryCard from "@/app/components/billing/BillingHistoryCard";
import FoundingMemberCTA from "@/app/components/billing/FoundingMemberCTA";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? "general";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, billing] = await Promise.all([
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    tab === "billing" && user ? getBillingDetails(user.id, supabase) : null,
  ]);

  const tabLinkStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-block",
    padding: "8px 0",
    marginRight: 24,
    fontSize: 14,
    fontWeight: active ? 500 : 400,
    color: active ? "#0A1A2F" : "#6B7A8D",
    textDecoration: "none",
    borderBottom: active ? "2px solid #2CA6A4" : "2px solid transparent",
  });

  return (
    <div className="px-8 py-8" style={{ maxWidth: 860, width: "100%" }}>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-medium text-ink">Settings</h1>
        <p className="mt-1 text-sm font-light text-dim">
          Manage your preferences and account configuration.
        </p>
      </div>

      {/* Tab navigation */}
      <div
        style={{
          borderBottom: "1px solid #D8E2EC",
          marginBottom: 32,
        }}
      >
        <Link href="?tab=general" style={tabLinkStyle(tab === "general")}>
          General
        </Link>
        <Link href="?tab=billing" style={tabLinkStyle(tab === "billing")}>
          Billing
        </Link>
        <Link href="?tab=account" style={tabLinkStyle(tab === "account")}>
          Account
        </Link>
      </div>

      {tab === "billing" && billing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Top row — Current Plan + Usage side by side */}
          {(billing.feature_tier === "core" ||
            billing.feature_tier === "growth" ||
            billing.plan === "founding_member") ? (
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, alignItems: "stretch" }}>
              <CurrentPlanCard billing={billing} />
              <UsageCard
                periodStart={billing.billing_period_start}
                periodEnd={billing.billing_period_end}
                tier={billing.feature_tier === "suspended" ? "core" : billing.feature_tier}
              />
            </div>
          ) : (
            <CurrentPlanCard billing={billing} />
          )}

          {billing.plan === "starter" && <FoundingMemberCTA />}

          <PlanComparisonCard
            currentPlan={billing.plan}
            currentTier={billing.feature_tier}
          />

          <BillingHistoryCard />
        </div>
      ) : tab === "account" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {user && (
            <AccountCard
              email={user.email ?? "—"}
              memberSince={user.created_at}
              businessName={profile?.business_name ?? null}
            />
          )}

          <ChangePasswordCard />

          {user && <PrivacyLegalCard email={user.email ?? ""} />}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <AlertPreferencesCard />

          {profile && <ThresholdsCard profile={profile} />}
        </div>
      )}
    </div>
  );
}
