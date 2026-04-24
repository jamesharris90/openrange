CREATE TABLE IF NOT EXISTS public.ticker_classifications (
  symbol TEXT PRIMARY KEY,
  stock_classification TEXT NOT NULL,
  classification_label TEXT NOT NULL,
  classification_reason TEXT NOT NULL,
  listing_type TEXT NOT NULL,
  instrument_detail TEXT NOT NULL DEFAULT 'COMMON_STOCK',
  instrument_detail_label TEXT NOT NULL DEFAULT 'Common Stock',
  source TEXT NOT NULL DEFAULT 'heuristic_v1',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticker_classifications_classification
  ON public.ticker_classifications (stock_classification);

CREATE INDEX IF NOT EXISTS idx_ticker_classifications_listing_type
  ON public.ticker_classifications (listing_type);