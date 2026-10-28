import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getOwnerOrganizationMonths, getFinancialImportStatus, getRecentFinancialImports } from "@/lib/db";
import { OrganizationAccessError, organizationSelection } from "@/lib/organizationAccess";
import type { OwnerMonthlyRead } from "@/lib/organizationAccess";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import ImportRefresher from "../ImportRefresher";
import FinancialDataProvenanceCard from "@/app/components/FinancialDataProvenanceCard";
import FinancialDataOverviewCard from "@/app/components/FinancialDataOverviewCard";
import RecentFinancialImportsCard from "@/app/components/RecentFinancialImportsCard";

export default async function FinancialDataPage({ searchParams }: { searchParams?: Promise<{ organization_id?: string | string[] }> } = {}) {
  const supabase = await createClient();
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user) redirect("/auth?reason=session_expired");
  if (!hasVerifiedEmail(user)) redirect(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`);
  let read: OwnerMonthlyRead;
  try {
    const selected = organizationSelection((await searchParams)?.organization_id);
    read = await getOwnerOrganizationMonths(user.id,selected,null,supabase);
  } catch (error) {
    if (error instanceof OrganizationAccessError && ["invalid_selection","not_found"].includes(error.reason)) notFound();
    return <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-medium text-ink">Financial data</h1>
      <p role="alert" className="mt-4 text-sm text-ink">We could not confirm access to your workspace. Reload this page to try again.</p>
      <a href="/dashboard" className="mt-4 inline-block text-sm text-teal underline">Back to dashboard</a>
    </div>;
  }
  if (read.state === "profile_missing") redirect("/dashboard");
  if (read.state === "subscription_required") redirect("/welcome");
  const months = read.months;
  // C permits only actor = original legacy owner; no impersonation for old loaders.
  const [importStatus,importHistory] = await Promise.all([
    getFinancialImportStatus(user.id,supabase),getRecentFinancialImports(user.id,10,supabase),
  ]);
  return <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
    <a href="/dashboard" className="text-sm underline" style={{color:"var(--teal)"}}>Back to dashboard</a>
    <h1 className="mt-4 text-2xl font-medium" style={{color:"var(--ink)"}}>Financial data</h1>
    <p className="mt-2 text-sm" style={{color:"var(--dim)"}}>Upload your monthly financial data, review the changes, then confirm your import.</p>
    <div className="mt-6 space-y-6">
      <FinancialDataOverviewCard months={months} />
      <ImportRefresher hasData={months.length > 0} />
      <RecentFinancialImportsCard history={importHistory} />
      <FinancialDataProvenanceCard months={months} importStatus={importStatus} />
    </div>
  </div>;
}
