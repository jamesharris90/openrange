export function calculateReactionQuality(reactionData: any) {
  const highOfDayPct = Number(reactionData?.high_of_day_pct);
  const closePct = Number(reactionData?.close_pct);
  const volumeVsAvg = Number(reactionData?.volume_vs_avg);
  const day2FollowthroughPct = Number(reactionData?.day2_followthrough_pct);
  const openGapPct = Number(reactionData?.open_gap_pct);

  const closeInUpper75 = Number.isFinite(highOfDayPct) && highOfDayPct > 0 && Number.isFinite(closePct)
    ? (closePct / highOfDayPct) >= 0.75
    : false;

  const strongVolume = Number.isFinite(volumeVsAvg) && volumeVsAvg > 2;
  const strongDay2 = Number.isFinite(day2FollowthroughPct) && day2FollowthroughPct > 3;

  let gapFadeOver50 = false;
  if (Number.isFinite(openGapPct) && openGapPct !== 0 && Number.isFinite(closePct)) {
    const sameDirection = Math.sign(closePct) === Math.sign(openGapPct);
    const retained = sameDirection ? Math.abs(closePct) : 0;
    const fadeRatio = (Math.abs(openGapPct) - retained) / Math.abs(openGapPct);
    gapFadeOver50 = fadeRatio > 0.5;
  }

  const reactionQualityScore =
    (closeInUpper75 ? 10 : 0) +
    (strongVolume ? 10 : 0) +
    (strongDay2 ? 10 : 0) +
    (gapFadeOver50 ? -10 : 0);

  return {
    reactionQualityScore,
    breakdown: {
      closeInUpper75: closeInUpper75 ? 10 : 0,
      volumeVsAvgAbove2: strongVolume ? 10 : 0,
      day2FollowthroughAbove3: strongDay2 ? 10 : 0,
      gapFadeOver50Pct: gapFadeOver50 ? -10 : 0,
    },
  };
}
