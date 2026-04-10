# OpenRange Operator Runbook

## Core Pipeline
stocks_in_play -> signals -> trade_setups -> outcomes -> decision

## Daily Checklist
- lifecycle overlap > 50
- decision coverage > 10
- signals active
- stocks_in_play active

## Critical Failures
- overlap = 0 -> STOP SYSTEM
- decision null rate > 70% -> WARNING
- signals_created = 0 during session -> ALERT

## Start Commands
npm run dev
node openrange_autoloop.js

## Key Endpoints
/api/health
/api/screener
/api/intelligence/top-opportunities
