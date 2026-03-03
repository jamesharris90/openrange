export type AdvancedFilterTab =
  | 'overview'
  | 'valuation'
  | 'financial'
  | 'ownership'
  | 'performance'
  | 'technical'
  | 'news'
  | 'etf';

export type FilterFieldType = 'select' | 'range';

export type FilterOption = {
  label: string;
  value: string;
};

export type FilterRangeValue = {
  min: string;
  max: string;
};

export type FilterValue = string | FilterRangeValue;

export type FilterFieldSchema = {
  key: string;
  label: string;
  type: FilterFieldType;
  tab: AdvancedFilterTab;
  options?: FilterOption[];
  finvizCode?: string;
  dataKey?: string;
  placeholderMin?: string;
  placeholderMax?: string;
};

export type FilterSchema = Record<AdvancedFilterTab, FilterFieldSchema[]>;
