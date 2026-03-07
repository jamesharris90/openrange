# OPENRANGE System Map

## Frontend Layer
React + Vite user interface.

Primary pages:
- Pre Market Command
- Open Market Radar
- Post Market Review
- Scanner
- Trading Cockpit
- Intel Inbox
- Dashboard

## API Layer
Node.js + Express route surface.

Key endpoints:
- `/api/radar/summary`
- `/api/quote`
- `/api/chart/mini`
- `/api/market/tickers`
- `/api/market/indices`
- `/api/intelligence`

## Engine Layer
Core backend intelligence engines:
- Universe Builder
- Metrics Engine
- Strategy Engine
- Strategy Signal Engine
- Radar Engine
- Intelligence Engine
- Scheduler

## Database Layer (Supabase / Postgres)
Core platform tables:
- `market_metrics`
- `strategy_signals`
- `company_profiles`
- `news_articles`
- `intel_emails`
- `intraday_ohlc`
- `daily_ohlc`

## Data Providers
External data and catalyst sources:
- Financial Modeling Prep
- Finviz
- News feeds
- Twitter/X catalysts

## Radar Architecture Flow
Market Data
	↓
Strategy Engine
	↓
Strategy Signal Engine
	↓
Radar Engine
	↓
Radar Summary API (`/api/radar/summary`)
	↓
Frontend Radar Dashboard
