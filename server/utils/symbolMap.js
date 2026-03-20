const SYMBOL_TO_PROVIDER = {
  VIX: '^VIX',
};

const PROVIDER_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_PROVIDER).map(([canonical, provider]) => [provider, canonical])
);

function normalizeSymbol(symbol) {
  return String(symbol || '').toUpperCase().trim();
}

function mapToProviderSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return SYMBOL_TO_PROVIDER[normalized] || normalized;
}

function mapFromProviderSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  return PROVIDER_TO_SYMBOL[normalized] || normalized;
}

module.exports = {
  normalizeSymbol,
  mapToProviderSymbol,
  mapFromProviderSymbol,
};