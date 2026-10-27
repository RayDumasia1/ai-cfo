import Link from "next/link";
import { redirect } from "next/navigation";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import { getForecastReviewQueue, getSubscription, hasPaidSubscription } from "@/lib/db";
import { hasFeature } from "@/lib/featureGates";
import { todayIso } from "@/lib/forecastWorkflow";
import { createClient } from "@/utils/supabase/server";
import ForecastReviewClient from "./ForecastReviewClient";

export default async function ForecastReviewPage() {
  const supabase=await createClient();const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)redirect("/auth?reason=session_expired");
  if(!hasVerifiedEmail(user))redirect(`/auth/verify?email=${encodeURIComponent(user.email??"")}`);
  if(!await hasPaidSubscription(user.id,supabase))redirect("/welcome");
  const subscription=await getSubscription(user.id,supabase);
  if(!hasFeature(subscription.feature_tier,"forecast_variance",user.email??""))return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
    <Link href="/dashboard/cash-planning" className="text-sm text-teal underline">Back to cash planning</Link>
    <section className="mt-6 rounded-lg border border-line bg-surface p-6"><h1 className="text-2xl font-medium text-ink">Review a completed week</h1>
      <p className="mt-3 text-sm text-dim">Compare actual cash with a published weekly plan, explain differences and keep a review history. Weekly review history is available on Growth.</p>
      <Link href="/dashboard/settings?tab=billing" className="mt-4 inline-flex text-sm text-teal underline">View plan options</Link>
      <p className="mt-4 text-sm text-dim">You can continue updating your Core weekly cash plan from current information.</p>
      <Link href="/dashboard/forecast" className="mt-3 inline-flex text-sm text-teal underline">Open weekly cash plan</Link>
    </section></div>;
  const queue=await getForecastReviewQueue(user.id,todayIso(),supabase);
  return <ForecastReviewClient initialQueue={queue}/>;
}
