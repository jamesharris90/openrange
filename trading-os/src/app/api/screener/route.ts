import { type NextRequest } from "next/server";
import { backendGet } from "@/app/api/_lib/proxy";

export async function GET(request: NextRequest) {
  return backendGet(request, "/api/screener");
}
