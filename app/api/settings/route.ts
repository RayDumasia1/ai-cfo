import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { upsertBusinessProfile } from "@/lib/db";
import { percentageToDecimal } from "@/lib/calculations";
import { monthlySelection,monthlyErrorResponse } from "@/lib/monthlyAuthority";

export const dynamic = "force-dynamic";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export const PATCH = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const {
    runway_warning_threshold: warn,
    runway_danger_threshold: danger,
    min_cash_reserve: reserve,
    burn_rate_warning_pct: burnPct,
  } = body as Record<string, unknown>;

  if (!isFiniteNumber(warn) || !isFiniteNumber(danger) || (reserve !== null && !isFiniteNumber(reserve)) || !isFiniteNumber(burnPct)) {
    return NextResponse.json(
      { error: "All threshold values must be finite numbers." },
      { status: 400 }
    );
  }

  if (danger >= warn) {
    return NextResponse.json(
      { error: "Danger threshold must be less than warning threshold." },
      { status: 400 }
    );
  }

  if (warn <= 0 || danger <= 0 || (reserve !== null && reserve < 0) || burnPct <= 0) {
    return NextResponse.json(
      { error: "All values must be positive (cash reserve may be 0)." },
      { status: 400 }
    );
  }
  const storedBurnPct = percentageToDecimal(burnPct);
  if (storedBurnPct === 0) {
    return NextResponse.json({ error: "Burn rate warning percentage is too small to store." }, { status: 400 });
  }

  const requestId = crypto.randomUUID();
  try {
    const selected=monthlySelection(req.nextUrl.searchParams);
    const saved = await upsertBusinessProfile(
      userId,
      {
        runway_warning_threshold: warn,
        runway_danger_threshold: danger,
        min_cash_reserve: reserve,
        // UI collects % (e.g. 10), store as decimal (0.10)
        burn_rate_warning_pct: storedBurnPct,
      },
      supabase,...(selected===null?[]:[selected])
    );
    if (!saved || saved.user_id !== userId || saved.runway_warning_threshold !== warn ||
        saved.runway_danger_threshold !== danger || saved.min_cash_reserve !== reserve ||
        saved.burn_rate_warning_pct !== storedBurnPct) {
      throw new Error("Could not confirm persisted thresholds");
    }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const authority=monthlyErrorResponse(error);
    if(authority){const{status,...body}=authority;return NextResponse.json({...body,requestId},{status,headers:{"Cache-Control":"no-store"}});}
    console.error("settings:thresholds:save:error", { requestId, userId });
    return NextResponse.json(
      { error: "Failed to save thresholds.", requestId },
      { status: 500,headers:{"Cache-Control":"no-store"} }
    );
  }
});
