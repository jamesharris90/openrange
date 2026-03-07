# Canonical Field Policy

This document defines the canonical data contract for OpenRange Trading.

## Core Rules

- All numeric fields must be numbers (no formatted strings).
- All timestamps must be ISO-8601 UTC.
- relativeVolume must be computed server-side.
- avgVolume30d must represent rolling 30 trading days.
- UI must never consume provider-shaped payloads directly.
- All canonical objects must include providerProvenance.

## Required Fields

CanonicalQuote:
- symbol
- price
- changePercent
- volume
- avgVolume30d
- relativeVolume
- timestamp
- providerProvenance

CanonicalNewsItem:
- id
- headline
- source
- publishedAt
- tickers
- providerProvenance

CanonicalEarnings:
- symbol
- earningsDate
- providerProvenance
