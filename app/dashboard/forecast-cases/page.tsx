import Link from "next/link";
import { redirect } from "next/navigation";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import { getForecastCases,getSubscription,hasPaidSubscription } from "@/lib/db";
import { hasFeature } from "@/lib/featureGates";
import { forecastCasesView } from "@/lib/forecastCases";
import { todayIso } from "@/lib/forecastWorkflow";
import { createClient } from "@/utils/supabase/server";
import ForecastCasesClient from "./ForecastCasesClient";
export default async function ForecastCasesPage(){
  const client=await createClient();const {data:{user},error}=await client.auth.getUser();
  if(error||!user)redirect("/auth?reason=session_expired");
  if(!hasVerifiedEmail(user))redirect(`/auth/verify?email=${encodeURIComponent(user.email??"")}`);
  if(!await hasPaidSubscription(user.id,client))redirect("/welcome");
  const subscription=await getSubscription(user.id,client);
  if(!hasFeature(subscription.feature_tier,"scenario_comparison",user.email??""))return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <Link href="/dashboard/cash-planning" className="text-sm text-teal underline">Back to cash planning</Link><section className="mt-6 rounded-lg border border-line bg-surface p-6">
      <h1 className="text-2xl font-medium text-ink">Compare cash-plan cases</h1><p className="mt-3 text-sm text-dim">Keep named downside and upside assumptions and compare their cash outcomes with a shared base plan. Saved cases are available on Growth.</p>
      <Link href="/dashboard/settings?tab=billing" className="mt-4 inline-flex text-sm text-teal underline">View plan options</Link>
      <p className="mt-4 text-sm text-dim">Your weekly base plan and temporary decision tests remain available on their existing plans.</p>
    </section></div>;
  return <ForecastCasesClient initialState={forecastCasesView(await getForecastCases(user.id,null,client),todayIso())}/>;
}
