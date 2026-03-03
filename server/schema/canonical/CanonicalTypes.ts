export type ProviderName =
  | "fmp"
  | "finviz"
  | "yahoo"
  | "finnhub"
  | "polygon"
  | "saxo"
  | "perplexity";

export interface ProviderProvenance {
  primary: ProviderName;
  fields: Record<string, string>;
  fallbacks?: ProviderName[];
  fetchedAt: string; // ISO timestamp
}

export interface CanonicalBase {
  providerProvenance: ProviderProvenance;
}
