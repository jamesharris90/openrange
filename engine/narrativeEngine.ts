/* eslint-disable no-console */
// @ts-nocheck

export function buildNarrative(input: {
  symbol: string;
  signal_type: string;
  expected_move_percent: number;
  catalyst_headlines: string[];
  score: number;
  confidence: number;
}): string {
  const symbol = String(input?.symbol || "UNKNOWN");
  const signalType = String(input?.signal_type || "signal");
  const expectedMove = Number(input?.expected_move_percent || 0);
  const catalystHeadline = (input?.catalyst_headlines || []).filter(Boolean)[0] || "recent catalyst activity";
  const score = Number(input?.score || 0);
  const confidence = Number(input?.confidence || 0);

  const direction = signalType.includes("bearish") || signalType.includes("down") ? "down" : "up";
  const timeframe = score >= 0.8 && confidence >= 0.8 ? "intraday" : score >= 0.65 ? "short-term" : "swing";

  return [
    `WHY: ${symbol} triggered on ${catalystHeadline}.`,
    `HOW: Signal is ${signalType} with expected direction ${direction}, supported by clustered catalyst strength and sentiment.`,
    `HOW FAR: Expected move is ${expectedMove.toFixed(2)}%.`,
    `WHEN: ${timeframe}.`,
  ].join(" ");
}
