# Migration: Universe cleanup - keep only US-listed actives over $2

Applied: 2026-04-21
Purpose: Align active universe with trading strategy (US-listed liquid equities).

## Rule applied

Active universe = symbol must be:
1. US-listed on major exchange (NASDAQ, NYSE, AMEX, BATS), AND
2. Currently trading (not delisted/private), AND
3. Most recent price >= $2

Anything else = deactivated.

## Categories deactivated

### Confirmed delisted/private (web verified)
HOLX (Blackstone-TPG), RNAM (Novartis), EXAS (Abbott), ZEUS (private),
TGNA (private), AFMD (OTC AFMDQ).

### Likely delisted (Finnhub also stale or empty)
TECTP, CCCX, ETHZ, MGIC, BSII, IVCA, DMN, PET, RENE, EPWK, IROQ, LVRO,
OS, BLFY, TBHC, SDM.

### SPAC instruments (out of trading strategy)
Units: TDWDU, SSEAU, SBXE-UN, ORIQU, TACOU, LPAAU, EVOXU, SCPQU
Warrants: OIOWW, LPCVW, XCBEW, ITHAW, BDCIW, SVAQW, DSACW, MESHW, MUZEW, LFACW
Rights: APACR, EMISR, LAFAR, KFIIR, MKLYR, GIWWR, TVAIR, SPEGR
Active SPAC unit: HCICU

### Preferred shares (out of trading strategy)
RAPT, QIPT, EMPG, COPL.

### Unknown SPAC-related
SBXE, FTII, YCY, TVAI, CRAQ, QVCD, UYSC.

### Borderline failures (foreign-listed, OTC, or sub-$2)
ABP (sub-$2), BGMSP (under $2), AHL (non-US/price unavailable),
CIGL (sub-$2), ZGM (sub-$2), APUS (under $2), BACQ (verification failed US-listing gate).

### Phase 14 carry-forward list
101 previously approved SPAC/shell companies, minus any symbols explicitly re-protected under Phase 21.

## Protected (must remain active)

US-listed, over $2, verified active:
CFLT, AL, VTYX, CLSD, ZENV, GLDD, UBFO, MODV, MRCC, BKHA, SNCR.

Reference: AAPL, NVDA, MSFT, SPY, QQQ, IWM.

## Total

Active universe before: 6,033
Active universe after: 5,898 (delta 135)

Reversal SQL: /tmp/phase21_reversal.sql

## Followup

1. Recurring auto-deactivation: detect HOLX-class signature, cross-check
   secondary provider, deactivate if both stale. Prevents future M&A
   delisting events from polluting the universe.

2. FMP support ticket: verified-active US-listed symbols (CFLT, AL, etc.)
   still show stale data on FMP. Build evidence package and submit.

3. Always-AVOID decision logic remains the highest priority product issue.