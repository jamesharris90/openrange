type OpportunityCandidate = {
  symbol?: unknown;
  strategy?: unknown;
  probability?: unknown;
  confidence?: unknown;
};

export function validateOpportunity(op: OpportunityCandidate): boolean {
  if (!op) return false;

  return (
    Boolean(op.symbol) &&
    Boolean(op.strategy) &&
    typeof op.probability === "number" &&
    typeof op.confidence === "number"
  );
}
