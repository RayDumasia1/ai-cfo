import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getFinancialMonths, getFinancialImportStatus, getRecentFinancialImports, hasPaidSubscription } from "@/lib/db";
import { hasVerifiedEmail } from "@/lib/authPolicy";
import ImportRefresher from "../ImportRefresher";
import FinancialDataProvenanceCard from "@/app/components/FinancialDataProvenanceCard";
import FinancialDataOverviewCard from "@/app/components/FinancialDataOverviewCard";
import RecentFinancialImportsCard from "@/app/components/RecentFinancialImportsCard";

export default async function FinancialDataPage() {
  const supabase = await createClient();
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user) redirect("/auth?reason=session_expired");
  if (!hasVerifiedEmail(user)) redirect(`/auth/verify?email=${encodeURIComponent(user.email ?? "")}`);
  if (!(await hasPaidSubscription(user.id,supabase))) redirect("/welcome");
  const [months,importStatus,importHistory] = await Promise.all([
    getFinancialMonths(user.id,null,supabase),getFinancialImportStatus(user.id,supabase),getRecentFinancialImports(user.id,10,supabase),
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
