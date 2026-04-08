import { apiGet } from "@/lib/api/client";

export type IntegrityIssue = {
  severity: "info" | "warning" | "critical";
  type: string;
  key: string;
  message: string;
  [key: string]: unknown;
};

export type IntegrityTable = {
  table: string;
  row_count: number;
  latest_timestamp: string | null;
  lag_minutes: number | null;
  freshness_threshold_minutes: number;
  status: "ok" | "degraded" | "down";
};

export type IntegrityPipelineCheck = {
  type: "backend" | "next";
  url: string | null;
  status: "ok" | "degraded" | "down";
  count: number;
  http_status: number | null;
};

export type IntegrityPipeline = {
  name: string;
  status: "ok" | "degraded" | "down";
  checks: IntegrityPipelineCheck[];
};

export type IntegrityPayload = {
  status: "ok" | "degraded" | "down";
  checked_at: string;
  issues: IntegrityIssue[];
  tables: IntegrityTable[];
  pipelines: IntegrityPipeline[];
  data_quality: Array<Record<string, unknown>>;
  parity: {
    status: "ok" | "degraded" | "down";
    symbols: Array<Record<string, unknown>>;
  };
};

function normalizePayload(response: Partial<IntegrityPayload> | undefined): IntegrityPayload {
  return {
    status: response?.status || "down",
    checked_at: response?.checked_at || new Date().toISOString(),
    issues: Array.isArray(response?.issues) ? response.issues : [],
    tables: Array.isArray(response?.tables) ? response.tables : [],
    pipelines: Array.isArray(response?.pipelines) ? response.pipelines : [],
    data_quality: Array.isArray(response?.data_quality) ? response.data_quality : [],
    parity: {
      status: response?.parity?.status || "down",
      symbols: Array.isArray(response?.parity?.symbols) ? response.parity.symbols : [],
    },
  };
}

export async function getDataIntegrity(): Promise<IntegrityPayload> {
  try {
    const payload = await apiGet<Partial<IntegrityPayload>>("/api/system/data-integrity", {
      cache: "no-store",
    });
    return normalizePayload(payload);
  } catch (error) {
    return normalizePayload({
      status: "down",
      checked_at: new Date().toISOString(),
      issues: [
        {
          severity: "critical",
          type: "client",
          key: "fetch_failed",
          message: error instanceof Error ? error.message : "Failed to fetch data integrity",
        },
      ],
      pipelines: [],
    });
  }
}
