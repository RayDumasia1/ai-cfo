import { createClient } from "@/utils/supabase/server";
import { getSubscription } from "@/lib/db";
import CfoCallButton from "@/app/components/billing/CfoCallButton";

export default async function CfoCallPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const subscription = user ? await getSubscription(user.id, supabase) : null;
  const tier = subscription?.feature_tier ?? "starter";

  return (
    <div className="px-8 py-8" style={{ maxWidth: 600 }}>
      <div className="mb-8">
        <h1 className="text-2xl font-medium text-ink">Book a CFO Call</h1>
        <p className="mt-1 text-sm font-light text-dim">
          A 60-minute strategy session with a certified financial advisor who
          reviews your Elidan dashboard before the call.
        </p>
      </div>

      {user && (
        <CfoCallButton
          userTier={tier}
          userEmail={user.email ?? ""}
        />
      )}
    </div>
  );
}
