const NULL_COPY = "—";

export function formatCurrency(value, digits = 2, fallback = NULL_COPY) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatCompactNumber(value, fallback = NULL_COPY) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatVolume(value, fallback = NULL_COPY) {
  return formatCompactNumber(value, fallback);
}

export function formatText(value, fallback = NULL_COPY) {
  const text = String(value || "").trim();
  return text || fallback;
}

export function formatNumber(value, digits = 2, fallback = NULL_COPY) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatMetricPercent(value, options = {}) {
  const { digits = 2, signed = true, scaleRatio = false, fallback = NULL_COPY } = options;
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const numeric = scaleRatio && Math.abs(value) <= 1 ? value * 100 : value;
  const sign = signed && numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(digits)}%`;
}

export function formatBooleanLabel(value, trueLabel = "Yes", falseLabel = "No", fallback = NULL_COPY) {
  if (typeof value !== "boolean") {
    return fallback;
  }

  return value ? trueLabel : falseLabel;
}

export function formatPercent(value, digits = 2, fallback = NULL_COPY) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatDate(value, fallback = NULL_COPY) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatSignedLabel(value, digits = 2, fallback = NULL_COPY) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function isNullDisplay(value) {
  return value === NULL_COPY;
}

export { NULL_COPY };