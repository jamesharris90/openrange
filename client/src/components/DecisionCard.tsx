import React from 'react';

type DecisionCardData = {
  symbol?: unknown;
  bias?: unknown;
  catalystType?: unknown;
  expectedMoveLabel?: unknown;
  truth_valid?: unknown;
  truth_reason?: unknown;
  trade_quality_score?: unknown;
  tradeable?: unknown;
  execution_plan?: unknown;
  setup?: unknown;
};

function qualityTone(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

function renderExecutionPlan(data: DecisionCardData): string {
  if (typeof data.execution_plan === 'string' && data.execution_plan.trim()) {
    return data.execution_plan;
  }

  if (typeof data.setup === 'string' && data.setup.trim()) {
    return `Setup: ${data.setup}. NO EXECUTION PLAN AVAILABLE`;
  }

  return 'NO EXECUTION PLAN AVAILABLE';
}

export function DecisionCard({ data }: { data: DecisionCardData | null | undefined }) {
  if (!data || typeof data !== 'object') {
    console.error('DECISION CARD DATA FAILURE', data);
    return null;
  }

  const required: Array<keyof DecisionCardData> = [
    'bias',
    'catalystType',
    'expectedMoveLabel',
    'truth_valid',
    'trade_quality_score',
    'tradeable',
  ];

  const hasMissing = required.some((key) => data[key] === undefined || data[key] === null);
  if (hasMissing) {
    console.error('DECISION CARD DATA FAILURE', data);
    return null;
  }

  const score = Number(data.trade_quality_score);
  const tradeQualityScore = Number.isFinite(score) ? score : 0;
  const truthValid = Boolean(data.truth_valid);
  const truthReason = typeof data.truth_reason === 'string' && data.truth_reason.trim()
    ? data.truth_reason
    : null;

  return (
    <div>
      <h3>Decision System</h3>
      <div>
        <strong>Trade Quality Score:</strong>{' '}
        <span className={qualityTone(tradeQualityScore)}>{tradeQualityScore}</span>
      </div>
      <div>
        <strong>Truth Status:</strong>{' '}
        {truthValid ? 'VALID TRADE SETUP' : `REJECTED: ${truthReason || 'UNKNOWN'}`}
      </div>
      <div>
        <strong>WHY IS IT MOVING</strong>
        <div>{String(data.catalystType)}</div>
      </div>
      <div>
        <strong>WHY IS IT TRADEABLE</strong>
        <div>{Boolean(data.tradeable) ? 'YES' : 'NO'}</div>
        {truthReason ? <div>{truthReason}</div> : null}
      </div>
      <div>
        <strong>HOW TO TRADE</strong>
        <div>{renderExecutionPlan(data)}</div>
      </div>
    </div>
  );
}

export default DecisionCard;
