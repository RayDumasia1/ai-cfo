import { getFoundingMemberAvailability } from "@/lib/foundingMembers";
import type { NextRequest } from "next/server";

// Never freeze the count at build time; caching is handled by Cache-Control.
export const dynamic = "force-dynamic";

const DEFAULT_ORIGIN = "https://elidan.ai";
const ALLOWED_ORIGINS = new Set([DEFAULT_ORIGIN, "https://www.elidan.ai"]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin":
      origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN,
    Vary: "Origin",
  };
}

export async function GET(req: NextRequest) {
  try {
    const { total, claimed, remaining, soldOut } =
      await getFoundingMemberAvailability();
    return Response.json(
      { total, claimed, remaining, soldOut, updatedAt: new Date().toISOString() },
      {
        headers: {
          ...corsHeaders(req),
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    // Never return a guessed count — the marketing site hides the counter on 503.
    console.error("public:foundingSpots:error", err);
    return Response.json(
      { error: "unavailable" },
      {
        status: 503,
        headers: {
          ...corsHeaders(req),
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
