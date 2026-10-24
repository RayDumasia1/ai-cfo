import { NextRequest } from "next/server";
import { handleFinancialImport } from "@/lib/financialImportHandler";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  return handleFinancialImport(request, "confirm");
}
