function asText(value, fallback = '--') {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str.length ? str : fallback;
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

export default function RadarCard({ item = {} }) {
  const symbol = asText(item?.symbol, 'N/A');
  const confidence = item?.confidence ?? item?.score ?? '--';
  const movementReason = asText(item?.movement_reason, 'No movement reason provided');
  const tradeReason = asText(item?.trade_reason, '');
  const tradePlan = asText(item?.trade_plan, 'No trade plan available');
  const setupGrade = asText(item?.setup_grade, '');

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <strong>{symbol}</strong>
        <span className="text-xs text-[var(--text-muted)]">Confidence: {confidence}</span>
      </div>
      {hasText(setupGrade) ? (
        <div className="mb-1 text-xs text-[var(--text-muted)]">Setup Grade: {setupGrade}</div>
      ) : null}
      <div className="mb-1 text-xs text-[var(--text-muted)]">{movementReason}</div>
      {hasText(tradeReason) ? (
        <div className="mb-1 text-xs text-[var(--text-muted)]">{tradeReason}</div>
      ) : null}
      <div className="text-xs">{tradePlan}</div>
    </div>
  );
}
