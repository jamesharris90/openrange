export type CongressionalChamberFilter = "all" | "senate" | "house";
export type CongressionalTransactionFilter = "all" | "purchase" | "sale";
export type CongressionalDaysFilter = "7" | "14" | "30" | "90" | "all";

export type CongressionalFilters = {
  chamber: CongressionalChamberFilter;
  transactionType: CongressionalTransactionFilter;
  days: CongressionalDaysFilter;
  highProfileOnly: boolean;
  symbol: string;
  member: string;
};

export type CongressionalTrade = {
  id: number;
  chamber: string | null;
  symbol: string | null;
  transaction_date: string | null;
  disclosure_date: string | null;
  first_name: string | null;
  last_name: string | null;
  district: string | null;
  owner: string | null;
  asset_description: string | null;
  asset_type: string | null;
  transaction_type: string | null;
  amount_range: string | null;
  amount_min: number | null;
  amount_max: number | null;
  source_link: string | null;
  is_high_profile?: boolean | null;
};

export type CongressionalRecentResponse = {
  total: number;
  limit: number;
  offset: number;
  results: CongressionalTrade[];
};
