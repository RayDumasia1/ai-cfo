import { NextRequest } from "next/server";
import { handleFinancialImport } from "@/lib/financialImportHandler";

export const dynamic = "force-dynamic";

// Retire direct writes safely: stale clients must refresh into the review flow.
export async function POST(request: NextRequest) {
  return handleFinancialImport(request, "legacy");
}