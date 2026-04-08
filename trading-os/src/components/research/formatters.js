export {
  NULL_COPY as WARMING_COPY,
  formatBooleanLabel,
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatMetricPercent,
  formatNumber,
  formatPercent,
  formatSignedLabel,
  formatText,
  formatVolume,
  isNullDisplay,
} from "@/utils/formatters";

export function toneFromChange(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "neutral";
  }

  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}

export function toneFromTrend(value) {
  if (value === "bullish") {
    return "positive";
  }

  if (value === "bearish") {
    return "negative";
  }

  return "neutral";
}