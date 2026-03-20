export type DataSource =
  | "fmp"
  | "polygon"
  | "authoritative_db"
  | "finviz"
  | "finnhub"
  | "perplexity"
  | "none";

export function normalizeDataSource(value: unknown): DataSource {
  const raw = String(value || "").trim().toLowerCase();
  if (
    raw === "fmp" ||
    raw === "polygon" ||
    raw === "authoritative_db" ||
    raw === "finviz" ||
    raw === "finnhub" ||
    raw === "perplexity"
  ) {
    return raw;
  }
  return "none";
}