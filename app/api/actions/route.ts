import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { createAction } from "@/lib/db";
import { getActionCapacityError, validateActionCreate } from "@/lib/actions";

import { operationalErrorResponse, operationalSelection } from "@/lib/operationalAuthority";

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
    const selected=operationalSelection(req.nextUrl.searchParams);
    const action=selected===null?await createAction(userId,parsed.value,supabase):await createAction(userId,parsed.value,supabase,selected);
    return NextResponse.json(action, { status: 201,headers:{"Cache-Control":"no-store"} });
  } catch (err) {
    const capacity = getActionCapacityError(err);
    if (capacity) return NextResponse.json({ error: "limit_reached", limit: capacity.limit }, { status: 403 });
    const mapped=operationalErrorResponse(err);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    const requestId = crypto.randomUUID();
    console.error("actions:create:error", { requestId, userId });
    return NextResponse.json({ error: "Failed to create action.", requestId }, { status: 500 });
  }
});
