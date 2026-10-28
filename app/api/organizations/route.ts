import { requireAuth } from "@/lib/apiAuth";
import { getOwnerOrganizations } from "@/lib/db";
import { OrganizationAccessError } from "@/lib/organizationAccess";
import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
const list = requireAuth(async (_req, { supabase }) => {
  try { return Response.json({ organizations: await getOwnerOrganizations(supabase) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const denied = error instanceof OrganizationAccessError && error.reason === "unauthorized";
    return Response.json({ error: denied ? "Workspace access could not be confirmed." : "Workspace list is temporarily unavailable." },
      { status: denied ? 403 : 503, headers: { "Cache-Control": "no-store" } });
  }
});
export async function GET(req: NextRequest, ctx: unknown) {
  const response = await list(req, ctx); response.headers.set("Cache-Control", "no-store"); return response;
}
