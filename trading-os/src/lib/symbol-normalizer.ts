export function normalizeSymbolForAPI(symbol: string): string {
  if (!symbol) return symbol;

  const upper = symbol.toUpperCase();

  if (upper === "VIX") return "^VIX";
  if (upper === "SPX") return "^GSPC";

  return upper;
}

export function normalizeSymbolForUI(symbol: string): string {
  if (!symbol) return symbol;
  return symbol.replace("^", "");
}
