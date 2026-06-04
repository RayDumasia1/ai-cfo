import { createServiceClient } from "@/utils/supabase/service";
import { getFoundingMemberCount } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();
  const count = await getFoundingMemberCount(supabase);
  const spotsRemaining = Math.max(0, 50 - count);
  return Response.json({
    available: count < 50,
    spots_remaining: spotsRemaining,
    total_spots: 50,
    is_sold_out: count >= 50,
  });
}
