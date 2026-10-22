import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { hasPaidSubscription } from "@/lib/db";
import { getFoundingMemberAvailability } from "@/lib/foundingMembers";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  if (await hasPaidSubscription(user.id, supabase)) redirect("/dashboard");

  const { total, remaining } = await getFoundingMemberAvailability();

  return (
    <WelcomeClient
      spotsRemaining={remaining}
      totalSpots={total}
      userEmail={user.email ?? ""}
    />
  );
}
