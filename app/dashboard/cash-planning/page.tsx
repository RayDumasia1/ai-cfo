import Link from "next/link";
import { ArrowRight, CalendarRange, ClipboardCheck, FlaskConical, GitCompare } from "lucide-react";
import { redirect } from "next/navigation";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import { CASH_PLANNING_COPY } from "@/lib/cashPlanning";
import { getSubscription, hasPaidSubscription } from "@/lib/db";
import { hasFeature } from "@/lib/featureGates";
import { createClient } from "@/utils/supabase/server";

export default async function CashPlanningPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/auth?reason=session_expired");
  if (!hasVerifiedEmail(user)) redirect(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`);
  if (!(await hasPaidSubscription(user.id, supabase))) redirect("/welcome");

  const subscription = await getSubscription(user.id, supabase);
  const canUseWeeklyPlan = hasFeature(subscription.feature_tier, "forecasting", user.email ?? "");
  const canReviewWeek = hasFeature(subscription.feature_tier, "forecast_variance", user.email ?? "");
  const canCompareCases = hasFeature(subscription.feature_tier, "scenario_comparison", user.email ?? "");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <Link href="/dashboard" className="text-sm text-teal underline">Back to dashboard</Link>
      <header className="mb-8 mt-4">
        <h1 className="text-2xl font-medium text-ink">{CASH_PLANNING_COPY.area}</h1>
        <p className="mt-1 text-sm text-dim">{CASH_PLANNING_COPY.areaDescription}</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <PlanningCard
          href="/dashboard/forecast-review"
          icon={ClipboardCheck}
          title="Review a completed week"
          description="See how actual cash compared with your published plan."
          detail="Record cash movements, explain differences and use the review to update your next plan."
          badge={canReviewWeek ? "Available on your plan" : "Growth feature"}
          action={canReviewWeek ? "Open weekly reviews" : "Learn about weekly reviews"}
        />
        <PlanningCard
          href="/dashboard/forecast"
          icon={CalendarRange}
          title={CASH_PLANNING_COPY.weeklyPlan}
          description={CASH_PLANNING_COPY.weeklyPlanDescription}
          detail="Add expected customer payments, payroll, bills, taxes, and other known cash activity."
          badge={canUseWeeklyPlan ? "Available on your plan" : "Core feature"}
          action={canUseWeeklyPlan ? "Open weekly cash plan" : "Learn about the weekly plan"}
        />
        <PlanningCard
          href="/dashboard/forecast-cases"
          icon={GitCompare}
          title="Compare cash-plan cases"
          description="See how downside and upside assumptions change your weekly cash."
          detail="Keep saved cases tied to the same base plan and compare cash timing and reserve risk."
          badge={canCompareCases ? "Available on your plan" : "Growth feature"}
          action={canCompareCases ? "Compare saved cases" : "Learn about saved cases"}
        />
        <PlanningCard
          href="/dashboard/scenarios"
          icon={FlaskConical}
          title={CASH_PLANNING_COPY.decisionTest}
          description={CASH_PLANNING_COPY.decisionTestDescription}
          detail="Try a different monthly collection, spending amount, or one-time cash event."
          badge="Available on your plan"
          action="Test a decision"
        />
      </div>

      <p className="mt-6 text-xs leading-relaxed text-dim">
        Your weekly cash plan is saved when you publish it. Decision tests are temporary unless you turn a result into an action.
      </p>
    </div>
  );
}

function PlanningCard({ href, icon: Icon, title, description, detail, badge, action }: {
  href: string;
  icon: typeof CalendarRange;
  title: string;
  description: string;
  detail: string;
  badge: string;
  action: string;
}) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <span className="rounded-full bg-teal/10 p-2.5 text-teal"><Icon aria-hidden="true" size={20} /></span>
        <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-medium text-dim">{badge}</span>
      </div>
      <h2 className="mt-5 text-lg font-medium text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink">{description}</p>
      <p className="mt-2 flex-1 text-xs leading-relaxed text-dim">{detail}</p>
      <Link href={href} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-teal no-underline">
        {action} <ArrowRight aria-hidden="true" size={15} />
      </Link>
    </section>
  );
}

