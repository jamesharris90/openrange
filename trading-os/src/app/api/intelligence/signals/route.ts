import { NextRequest } from "next/server";
import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return backendGet(request, "/api/intelligence/signals");
}

export async function POST() {
  return Response.json({ success: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
