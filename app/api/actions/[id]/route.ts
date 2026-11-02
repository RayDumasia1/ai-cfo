import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import {
  deleteAction,
  getAction,
  updateAction,
} from "@/lib/db";
import { getActionCapacityError, validateActionUpdate } from "@/lib/actions";

import { operationalErrorResponse, operationalSelection } from "@/lib/operationalAuthority";

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
    const selected=operationalSelection(req.nextUrl.searchParams);
    const current=selected===null?await getAction(userId,id,supabase):await getAction(userId,id,supabase,selected);
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const action=await updateAction(userId,id,parsed.value,selected===null?{}:{organizationId:selected},supabase);
    return NextResponse.json(action,{headers:{"Cache-Control":"no-store"}});
  } catch (err) {
    const capacity = getActionCapacityError(err);
    if (capacity) return NextResponse.json({ error: "limit_reached", limit: capacity.limit }, { status: 403 });
    const mapped=operationalErrorResponse(err);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    const requestId = crypto.randomUUID();
    console.error("actions:update:error", { requestId, userId });
    return NextResponse.json({ error: "Failed to update action.", requestId }, { status: 500 });
  }
});

export const DELETE = requireAuth<Ctx>(async (req: NextRequest, { userId, supabase }, { params }) => {
  const { id } = await params;

  try {
    const selected=operationalSelection(req.nextUrl.searchParams);
    if(selected===null)await deleteAction(userId,id,supabase);else await deleteAction(userId,id,supabase,selected);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const mapped=operationalErrorResponse(err);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    console.error("actions:delete:error",{requestId:crypto.randomUUID()});
    return NextResponse.json({ error: "Failed to delete action." }, { status: 500 });
  }
});
