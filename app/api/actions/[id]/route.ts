import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import {
  deleteAction,
  getAction,
  getActiveActionCount,
  getSubscription,
  updateAction,
} from "@/lib/db";
import { getActionCapacityError, getActionLimitState, validateActionUpdate } from "@/lib/actions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = requireAuth<Ctx>(async (req: NextRequest, { userId, supabase }, { params }) => {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateActionUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const current = await getAction(userId, id, supabase);
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Reopening a completed action takes an active slot — enforce the tier limit
    const reopening =
      current.status === "completed" &&
      parsed.value.status !== undefined &&
      parsed.value.status !== "completed";
    if (reopening) {
      const [subscription, activeCount] = await Promise.all([
        getSubscription(userId, supabase),
        getActiveActionCount(userId, supabase),
      ]);
      const { limit, atLimit } = getActionLimitState(subscription.feature_tier, activeCount);
      if (atLimit) {
        return NextResponse.json({ error: "limit_reached", limit }, { status: 403 });
      }
    }

    // The database commits the update and any status history together.
    const action = await updateAction(userId, id, parsed.value, {}, supabase);
    return NextResponse.json(action);
  } catch (err) {
    const capacity = getActionCapacityError(err);
    if (capacity) return NextResponse.json({ error: "limit_reached", limit: capacity.limit }, { status: 403 });
    const requestId = crypto.randomUUID();
    console.error("actions:update:error", { requestId, userId });
    return NextResponse.json({ error: "Failed to update action.", requestId }, { status: 500 });
  }
});

export const DELETE = requireAuth<Ctx>(async (_req: NextRequest, { userId, supabase }, { params }) => {
  const { id } = await params;

  try {
    await deleteAction(userId, id, supabase);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("actions:delete:error", message);
    return NextResponse.json({ error: "Failed to delete action." }, { status: 500 });
  }
});
