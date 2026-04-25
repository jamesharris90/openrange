function alignSingleSignal(signals) {
  const bySymbol = new Map();

  for (const signal of signals || []) {
    if (!signal?.symbol || !signal?.fired) continue;

    const existing = bySymbol.get(signal.symbol) || {
      symbol: signal.symbol,
      direction: signal.direction || 'neutral',
      alignment: {
        mode: 'single_signal',
        signalCount: 0,
        categories: [],
        hasContradiction: false,
      },
      signals: [],
    };

    existing.signals.push(signal);
    existing.alignment.signalCount = existing.signals.length;
    existing.alignment.categories = [...new Set(existing.signals.map((item) => item.signalCategory))];
    bySymbol.set(signal.symbol, existing);
  }

  return [...bySymbol.values()];
}

module.exports = {
  alignSingleSignal,
};