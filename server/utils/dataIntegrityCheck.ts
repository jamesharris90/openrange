import type { CanonicalQuote } from '../schema/canonical/CanonicalQuote';

export function validateCanonicalQuote(quote: CanonicalQuote): void {
  try {
    const warnings: string[] = [];

    Object.entries(quote || {}).forEach(([key, value]) => {
      if (value === undefined) {
        warnings.push(`Undefined field: ${key}`);
        return;
      }

      if (typeof value === 'number' && Number.isNaN(value)) {
        warnings.push(`NaN field: ${key}`);
      }
    });

    if (!(quote?.price > 0)) {
      warnings.push('Price must be > 0');
    }

    if (!(quote?.volume >= 0)) {
      warnings.push('Volume must be >= 0');
    }

    if (typeof quote?.price === 'number' && quote.price > 0 && typeof quote?.change === 'number' && typeof quote?.changePercent === 'number') {
      const expectedChangePct = (quote.change / quote.price) * 100;
      const diff = Math.abs(expectedChangePct - quote.changePercent);
      if (diff > 0.5) {
        warnings.push(`changePercent mismatch > 0.5% (diff=${diff.toFixed(2)})`);
      }
    }

    if (warnings.length > 0) {
      console.warn('[dataIntegrityCheck] CanonicalQuote warning', {
        symbol: quote?.symbol,
        warnings,
      });
    }
  } catch (error) {
    console.warn('[dataIntegrityCheck] validation failed safely', {
      symbol: quote?.symbol,
      message: (error as Error)?.message || 'Unknown error',
    });
  }
}
