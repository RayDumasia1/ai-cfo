import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardLayout from "@/app/components/DashboardLayout";

/**
 * Server-side auth guard for all /dashboard routes.
 *
 * getUser() validates the session JWT against the Supabase Auth server on
 * every request — not just against the local cookie — so forged or expired
 * tokens are rejected before any dashboard content is rendered.
 */
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth?reason=session_expired");
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
