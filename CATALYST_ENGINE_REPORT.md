# OpenRange Catalyst Engine Report

Date: 2026-03-08

## Implementation Summary

- Built `server/engines/catalystEngine.js` to parse `news_articles`, extract valid symbols, classify catalyst type, assign sentiment, score impact, and upsert into `news_catalysts`.
- Integrated catalyst impact into `server/engines/stocksInPlayEngine.js` so signals are boosted when a catalyst exists in the last 24h.
- Added `GET /api/intelligence/catalysts` in `server/routes/intelligence.js`.
- Added morning brief integration in `server/engines/morningBriefEngine.js` and rendering in `server/services/emailService.js` with a dedicated **Top Catalysts** section.

## Classification + Scoring Rules

- Ticker extraction regex: `\b[A-Z]{2,5}\b`
- Symbol validation source: `market_quotes.symbol`
- Catalyst classes:
	- earnings
	- analyst upgrade
	- analyst downgrade
	- FDA approval
	- government contract
	- acquisition
	- sector news
	- macro news
- Sentiment classes: `bullish`, `bearish`, `neutral`
- Impact score map:
	- earnings -> 9
	- FDA approval -> 10
	- analyst upgrade -> 6
	- analyst downgrade -> 6
	- government contract -> 8
	- acquisition -> 7
	- sector news -> 4
	- macro news -> 3

## Runtime Validation

- Catalyst engine run:
	- headlines parsed: `83`
	- tickers detected: `10`
	- catalysts stored: `10`
- Total catalysts currently in `news_catalysts`: `10`
- Stocks in play run after boost integration:
	- selected: `20`
	- upserted: `20`
	- signals boosted: `0`
- API endpoint status:
	- `GET /api/intelligence/catalysts` -> HTTP `200`

## Morning Brief Integration

- Added query:

```sql
SELECT symbol, catalyst_type, impact_score
FROM news_catalysts
ORDER BY impact_score DESC
LIMIT 5
```

- Morning brief test run returned `topCatalysts: 5`.
- Email template now renders a **Top Catalysts** section with ticker links and impact scores.

## What This Unlocks

This engine upgrades OpenRange from raw headline ingestion to actionable catalyst intelligence.

The system can now identify **Stocks In Play** with explicit catalyst context, which is the entire game for day traders.

## What Comes After This

The next engine is the **Narrative Intelligence Engine**.

It should detect themes like:

- AI boom
- Energy rally
- Defense sector momentum
- Rate cut narrative

Then link those narratives to:

- sectors
- stocks
- signals

This is the same strategic layer used by institutional desks and Bloomberg-style internal workflows.
