import { NextRequest,NextResponse } from "next/server";
import { requireAuth } from "@/lib/apiAuth";
import { getOwnedUsageStatus } from "@/lib/db";
import { operationalSelection,operationalErrorResponse } from "@/lib/operationalAuthority";
export const dynamic="force-dynamic";
export const GET=requireAuth(async(req:NextRequest,{userId,supabase})=>{
  try{
    const selected=operationalSelection(req.nextUrl.searchParams);
    const usage=await getOwnedUsageStatus(userId,supabase,selected);
    return NextResponse.json({usage},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const mapped=operationalErrorResponse(error);
    if(mapped)return NextResponse.json({error:mapped.error,code:mapped.code},{status:mapped.status,headers:{"Cache-Control":"no-store"}});
    const requestId=crypto.randomUUID();console.error("usage:status:error",{requestId});
    return NextResponse.json({error:"Usage is temporarily unavailable.",requestId},{status:503,headers:{"Cache-Control":"no-store"}});
  }
});
