import { NextRequest } from "next/server";
import { POST as importFinancialData } from "../route";

export const dynamic = "force-dynamic";

// Compatibility endpoint: the shared handler now requires the review flow
// instead of permitting an older client to write immediately.
export async function POST(request: NextRequest) {
  return importFinancialData(request);
}
