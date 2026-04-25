# Beacon v0 Signal Interface

Each signal in `server/beacon-v0/signals/<name>.js` exports:

- `SIGNAL_NAME` (string): canonical signal name used in alignment and storage
- `CATEGORY` (string): grouping for UI display (e.g. `volume`, `price`, `news`, `earnings`)
- `detect(universe, options)`: async function returning `Map<symbol, result>`
  - For leaderboard signals: returns up to `TOP_N` symbols ranked by signal strength
  - For per-symbol signals: returns a result for every input symbol
- `RUN_MODE` (string): `leaderboard` or `per-symbol`

Result shape:

```js
{
  symbol: string,
  signal: SIGNAL_NAME,
  rank: number, // 1-indexed within this signal
  score: number, // signal strength, higher = stronger
  metadata: object, // signal-specific data
  reasoning: string, // human-readable explanation
}
```

Leaderboard signals SHOULD only return symbols where the signal genuinely fires
(e.g. RVOL > 1.5x, gap > 1%, news count > 0). Do not pad to `TOP_N` with weak hits.