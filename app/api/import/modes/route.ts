import { NextRequest } from "next/server";
import { POST as importFinancialData } from "../route";

export const dynamic = "force-dynamic";

// A distinct endpoint prevents a new client from asking an older deployment
// to update months when that deployment only understands full replacement.
export async function POST(request: NextRequest) {
  return importFinancialData(request);
}
