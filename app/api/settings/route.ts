import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { upsertBusinessProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

export const PATCH = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    runway_warning_threshold,
    runway_danger_threshold,
    min_cash_reserve,
    burn_rate_warning_pct,
  } = body as Record<string, unknown>;

  const warn = Number(runway_warning_threshold);
  const danger = Number(runway_danger_threshold);
  const reserve = Number(min_cash_reserve);
  const burnPct = Number(burn_rate_warning_pct);

  if ([warn, danger, reserve, burnPct].some(Number.isNaN)) {
    return NextResponse.json(
      { error: "All threshold values must be numbers." },
      { status: 400 }
    );
  }

  if (danger >= warn) {
    return NextResponse.json(
      { error: "Danger threshold must be less than warning threshold." },
      { status: 400 }
    );
  }

  if (warn <= 0 || danger <= 0 || reserve < 0 || burnPct <= 0) {
    return NextResponse.json(
      { error: "All values must be positive (cash reserve may be 0)." },
      { status: 400 }
    );
  }

  try {
    await upsertBusinessProfile(
      userId,
      {
        runway_warning_threshold: warn,
        runway_danger_threshold: danger,
        min_cash_reserve: reserve,
        // UI collects % (e.g. 10), store as decimal (0.10)
        burn_rate_warning_pct: burnPct / 100,
      },
      supabase
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to save thresholds.", detail: message },
      { status: 500 }
    );
  }
});
