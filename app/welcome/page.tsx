import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
import { getFoundingMemberCount, hasPaidSubscription } from "@/lib/db";
import { FOUNDING_MEMBER_SPOTS } from "@/lib/launchConfig";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  if (await hasPaidSubscription(user.id, supabase)) redirect("/dashboard");

  // Service client: the count spans all users, which RLS would hide.
  const foundingMemberCount = await getFoundingMemberCount(createServiceClient());
  const spotsRemaining = Math.max(0, FOUNDING_MEMBER_SPOTS - foundingMemberCount);

  return (
    <WelcomeClient
      spotsRemaining={spotsRemaining}
      totalSpots={FOUNDING_MEMBER_SPOTS}
    />
  );
}
