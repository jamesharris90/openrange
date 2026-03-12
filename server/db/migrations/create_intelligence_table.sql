create table if not exists opportunity_intelligence (
    id uuid primary key default gen_random_uuid(),

    symbol text not null,
    score numeric,

    price numeric,
    gap_percent numeric,
    relative_volume numeric,

    catalyst text,

    movement_reason text,
    trade_reason text,
    trade_plan text,

    confidence numeric,

    created_at timestamp default now()
);

create index if not exists idx_intelligence_symbol
on opportunity_intelligence(symbol);

create index if not exists idx_intelligence_created
on opportunity_intelligence(created_at desc);

create unique index if not exists idx_intelligence_symbol_day
on opportunity_intelligence(symbol, (created_at::date));
