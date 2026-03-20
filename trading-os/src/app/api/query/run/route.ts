import { NextRequest } from "next/server";

import { backendPost } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return backendPost(request, "/api/query/run");
}
