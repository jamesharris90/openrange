import { apiGet } from "@/lib/api/client";
import { adaptSystemHealthPayload, type SystemHealthSnapshot } from "@/lib/adapters";

export async function getSystemHealth(): Promise<SystemHealthSnapshot> {
  const response = await apiGet<Record<string, unknown>>("/api/system/health");
  return adaptSystemHealthPayload(response);
}
