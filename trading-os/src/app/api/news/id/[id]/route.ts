import { NextRequest } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const id = encodeURIComponent(params.id || "");
  return backendGet(request, `/api/news/id/${id}`);
}
