ALTER TABLE public.catalyst_events
  ADD COLUMN IF NOT EXISTS published_at timestamp without time zone;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalyst_events_news_id
  ON public.catalyst_events(news_id)
  WHERE news_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalyst_intelligence_news_id
  ON public.catalyst_intelligence(news_id)
  WHERE news_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalyst_signals_news_id
  ON public.catalyst_signals(news_id)
  WHERE news_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalyst_reactions (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  news_id bigint,
  reaction_type text,
  abnormal_volume_ratio numeric,
  first_5m_move numeric,
  current_move numeric,
  continuation_probability numeric,
  expectation_gap_score numeric,
  priced_in_flag boolean,
  qqq_trend numeric,
  spy_trend numeric,
  sector_alignment numeric,
  is_tradeable_now boolean,
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalyst_reactions_symbol
  ON public.catalyst_reactions(symbol);

CREATE INDEX IF NOT EXISTS idx_catalyst_reactions_news_id
  ON public.catalyst_reactions(news_id);

CREATE INDEX IF NOT EXISTS idx_catalyst_reactions_created_at
  ON public.catalyst_reactions(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalyst_reactions_news_id
  ON public.catalyst_reactions(news_id)
  WHERE news_id IS NOT NULL;
