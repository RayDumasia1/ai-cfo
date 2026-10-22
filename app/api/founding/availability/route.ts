import { getFoundingMemberAvailability } from "@/lib/foundingMembers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { total, remaining, soldOut } = await getFoundingMemberAvailability();
  return Response.json({
    available: !soldOut,
    spots_remaining: remaining,
    total_spots: total,
    is_sold_out: soldOut,
  });
}
