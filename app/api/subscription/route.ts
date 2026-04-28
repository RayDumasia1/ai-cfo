import { requireAuth } from "@/lib/apiAuth";
import { getSubscription } from "@/lib/db";

export const GET = requireAuth(async (_req, { userId, supabase }) => {
  const sub = await getSubscription(userId, supabase);
  return Response.json(sub);
});
