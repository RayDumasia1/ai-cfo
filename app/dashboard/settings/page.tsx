import { createClient } from "@/utils/supabase/server";
import { getOrCreateBusinessProfile, getSubscription } from "@/lib/db";
import AlertPreferencesCard from "@/app/components/settings/AlertPreferencesCard";
import ThresholdsCard from "@/app/components/settings/ThresholdsCard";
import ChangePasswordCard from "@/app/components/settings/ChangePasswordCard";
import AccountCard from "@/app/components/settings/AccountCard";
import CfoCallButton from "@/app/components/billing/CfoCallButton";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, subscription] = await Promise.all([
    user ? getOrCreateBusinessProfile(user.id, supabase) : null,
    user ? getSubscription(user.id, supabase) : null,
  ]);

  return (
    <div className="px-8 py-8" style={{ maxWidth: 640 }}>
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-medium text-ink">Settings</h1>
          <p className="mt-1 text-sm font-light text-dim">
            Manage your preferences and account configuration.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {/* Section 1 — Alert Preferences */}
          <AlertPreferencesCard />

          {/* Section 2 — Financial Thresholds */}
          {profile && <ThresholdsCard profile={profile} />}

          {/* Section 3 — Change Password */}
          <ChangePasswordCard />

          {/* Section 4 — Account */}
          {user && (
            <AccountCard
              email={user.email ?? "—"}
              memberSince={user.created_at}
            />
          )}

          {/* Section 5 — CFO Call */}
          {user && subscription && (
            <CfoCallButton
              userTier={subscription.feature_tier}
              userEmail={user.email ?? ""}
            />
          )}
        </div>
      </div>
  );
}
