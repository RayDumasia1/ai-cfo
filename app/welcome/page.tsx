import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getBillingDetails, hasPaidSubscription } from "@/lib/db";
import { getFoundingMemberAvailability } from "@/lib/foundingMembers";
import { getReturningFoundingMember } from "@/lib/foundingMemberState";
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

  const billing = await getBillingDetails(user.id, supabase);
  const returningMember = getReturningFoundingMember(billing);
  // Existing holders do not compete for new spots or depend on the public count.
  const { total, remaining } = returningMember
    ? { total: FOUNDING_MEMBER_SPOTS, remaining: 0 }
    : await getFoundingMemberAvailability();

  return (
    <WelcomeClient
      spotsRemaining={remaining}
      totalSpots={total}
      userEmail={user.email ?? ""}
      returningMember={returningMember}
    />
  );
}
