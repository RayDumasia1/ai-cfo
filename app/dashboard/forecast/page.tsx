import Link from "next/link";
import { redirect } from "next/navigation";
import { getBusinessProfile, getLatestForecastCash, getSubscription } from "@/lib/db";
import { hasFeature } from "@/lib/featureGates";
import { createClient } from "@/utils/supabase/server";
import ForecastClient from "./ForecastClient";

export default async function ForecastPage(){
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)redirect("/auth?reason=session_expired");
  const [subscription,cash,profile]=await Promise.all([getSubscription(user.id,supabase),getLatestForecastCash(user.id,supabase),getBusinessProfile(user.id,supabase)]);
  if(!hasFeature(subscription.feature_tier,"forecasting",user.email??"")) return <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8"><Link href="/dashboard" className="text-sm text-teal underline">Back to dashboard</Link><section className="mt-6 rounded-lg border border-line bg-surface p-6 shadow-sm"><h1 className="text-2xl font-medium text-ink">Plan the next 13 weeks of cash</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">Build a weekly view of expected customer receipts and payments, identify the lowest cash point, and turn risks into actions. The manual base forecast is available on Core.</p><Link href="/dashboard/settings?tab=billing" className="mt-5 inline-flex rounded-md bg-teal px-4 py-2 text-sm font-medium text-white no-underline">View Core plan</Link></section></div>;
  return <ForecastClient initialCash={cash?.cash??null} initialAsOf={cash?.asOfDate??null} initialReserve={profile?.min_cash_reserve??0}/>;
}
