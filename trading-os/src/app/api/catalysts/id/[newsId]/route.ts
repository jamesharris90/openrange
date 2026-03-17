import { NextRequest } from "next/server";

import { backendGet } from "@/app/api/_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { newsId: string } }) {
  const newsId = encodeURIComponent(params.newsId || "");
  return backendGet(request, `/api/catalysts/id/${newsId}`);
}
