export type DecisionAction = "ENTER" | "WATCH" | "WAIT" | "AVOID";
export type DecisionUrgency = "LOW" | "MED" | "HIGH";

export type TradeLike = {
  confidence?: number | string | null;
  volume?: number | string | null;
  relative_volume?: number | string | null;
  market_session?: string | null;
  session_phase?: string | null;
  setup_state?: string | null;
};

export type DecisionResult = {
  action: DecisionAction;
  reason: string;
  urgency: DecisionUrgency;
};

function toNum(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toText(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function getDecision(trade: TradeLike): DecisionResult {
  const confidence = toNum(trade.confidence, 0);
  const volume = toNum(trade.volume, 0);
  const relativeVolume = toNum(trade.relative_volume, 0);
  const session = `${toText(trade.market_session)} ${toText(trade.session_phase)} ${toText(trade.setup_state)}`;

  const isEarly = /EARLY|PREMARKET|OPEN/.test(session);
  const isConfirming = /CONFIRM|RECLAIM|CONTINUATION/.test(session);
  const isExtended = /EXTENDED|LATE|OVERBOUGHT|EXHAUST/.test(session);
  const isLowVolume = relativeVolume > 0 ? relativeVolume < 1 : volume > 0 && volume < 500000;

  if (isExtended) {
    return {
      action: "AVOID",
      reason: "Extended move with poor edge-to-risk.",
      urgency: "LOW",
    };
  }

  if (isLowVolume) {
    return {
      action: "WAIT",
      reason: "Participation is thin; wait for stronger volume confirmation.",
      urgency: "LOW",
    };
  }

  if (confidence > 80 && isEarly) {
    return {
      action: "ENTER",
      reason: "Early breakout with strong probability and momentum alignment.",
      urgency: "HIGH",
    };
  }

  if (isConfirming) {
    return {
      action: "WATCH",
      reason: "Setup is confirming; wait for trigger level to break.",
      urgency: confidence >= 70 ? "MED" : "LOW",
    };
  }

  if (confidence >= 75) {
    return {
      action: "WATCH",
      reason: "High confidence but trigger quality is not fully confirmed.",
      urgency: "MED",
    };
  }

  return {
    action: "WAIT",
    reason: "Signal is live but does not yet meet entry quality.",
    urgency: "LOW",
  };
}
