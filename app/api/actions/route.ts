import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { createAction, getActiveActionCount, getSubscription } from "@/lib/db";
import { getActionLimitState, validateActionCreate } from "@/lib/actions";

export const dynamic = "force-dynamic";

export const POST = requireAuth(async (req: NextRequest, { userId, supabase }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateActionCreate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const [subscription, activeCount] = await Promise.all([
      getSubscription(userId, supabase),
      getActiveActionCount(userId, supabase),
    ]);

    // Creating a completed action doesn't consume an active slot
    if (parsed.value.status !== "completed") {
      const { limit, atLimit } = getActionLimitState(subscription.feature_tier, activeCount);
      if (atLimit) {
        return NextResponse.json({ error: "limit_reached", limit }, { status: 403 });
      }
    }

    const action = await createAction(userId, parsed.value, supabase);
    return NextResponse.json(action, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("actions:create:error", message);
    return NextResponse.json({ error: "Failed to create action." }, { status: 500 });
  }
});
