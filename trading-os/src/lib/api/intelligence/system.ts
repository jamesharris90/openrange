import type { EmailAnalytics, SystemHealth } from "@/lib/types";

import { apiGet, apiPost } from "@/lib/api/client";

export async function getSystemDiagnostics(): Promise<SystemHealth[]> {
  const response = await apiGet<{ data?: { checks?: Array<{ name?: string; status?: string; detail?: string }> } }>(
    "/api/intelligence/system"
  );
  const checks = response.data?.checks;
  if (!checks) {
    throw new Error("No data returned from API");
  }

  return checks.map((item) => ({
    name: String(item.name || "system"),
    status: item.status === "ok" ? "ok" : "error",
    detail: String(item.detail || ""),
  }));
}

export async function getEmailAnalytics(): Promise<EmailAnalytics> {
  const response = await apiGet<{ data?: { email?: Record<string, unknown> } }>("/api/intelligence/system");
  const email = response.data?.email || {};
  const scheduler = (email.scheduler as Record<string, unknown>) || {};
  const activeSubscribers = Number(email.activeSubscribers || 0);

  return {
    open_rate: Number(scheduler.openRate || 0),
    click_rate: Number(scheduler.clickRate || 0),
    subscriber_growth: activeSubscribers,
    top_links: [],
  };
}

export async function triggerBroadcast(type: "newsletter" | "signals_digest", recipient?: string) {
  return apiPost("/api/intelligence/system", {
    newsletterType: type === "newsletter" ? "beacon_morning" : "stocks_in_play",
    recipient,
  });
}
