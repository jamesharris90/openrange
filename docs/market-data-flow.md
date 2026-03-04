# Market Data Flow

## Pipeline

FMP → Adapter → Canonical → Services → Engine → Route → UI

1. FMP provider endpoints return raw market/news/earnings payloads.
2. Adapter layer maps provider payloads into canonical contracts.
3. Canonical services (RVOL, integrity checks) normalize deterministic fields.
4. Engine layer (scoring) computes deterministic intelligence outputs.
5. Routes expose canonical payloads to frontend pages.
6. UI consumes canonical fields only and does not compute RVOL.

## Source Precedence Logic

- Canonical quote source is currently `FMP` by default.
- Composite logic supports multi-source aggregation for RVOL:
  - If all sources are within 1% deviation, average them.
  - If deviation exceeds 3%, use FMP value.
  - If only one source exists, use that source.
  - If average volume is missing, RVOL returns `null`.

## RVOL Calculation Logic

- Base RVOL formula:

  `currentVolume / avgVolume30d`

- Guardrails:
  - If `currentVolume <= 0`, RVOL is `0` for direct calculation.
  - If `avgVolume30d <= 0`, RVOL is `0` for direct calculation.
  - Composite RVOL returns `{ value: null, confidence: "LOW" }` when no valid sources exist.

- Composite output:
  - `value: number | null`
  - `confidence: "HIGH" | "MEDIUM" | "LOW"`

## Scoring Weighting Logic

Scoring engine output fields:

- `liquidityScore`
- `catalystScore`
- `technicalScore`
- `compositeScore`
- `tier`

Weighting:

- Liquidity: 40%
- Catalyst: 40%
- Technical: 20%

Tier mapping (deterministic):

- Tier 1: composite ≥ 80
- Tier 2: composite ≥ 60 and < 80
- Tier 3: composite < 60

## Error Handling Philosophy

- Canonical routes favor stability and deterministic responses.
- Provider errors are logged with context (status code, response size, mapping warnings).
- Missing provider fields are handled defensively in adapters.
- Integrity issues produce warnings only; they never crash routes.
- Structured errors are returned for fatal canonical route failures.
