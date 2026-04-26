import { createClient } from "@/utils/supabase/server";
import { getOrCreateBusinessProfile } from "@/lib/db";
import DashboardLayout from "@/app/components/DashboardLayout";
import AlertPreferencesCard from "@/app/components/settings/AlertPreferencesCard";
import ThresholdsCard from "@/app/components/settings/ThresholdsCard";
import ChangePasswordCard from "@/app/components/settings/ChangePasswordCard";
import AccountCard from "@/app/components/settings/AccountCard";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? await getOrCreateBusinessProfile(user.id, supabase)
    : null;

  return (
    <DashboardLayout>
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
        </div>
      </div>
    </DashboardLayout>
  );
}
