export const DATA_CONTRACT = {
  FLOW_SIGNALS: "flow_signals",
  OPPORTUNITY_STREAM: "opportunity_stream",
  MARKET_NEWS: "market_news",
  MARKET_METRICS: "market_metrics",
  INTRADAY_DATA: "intraday_1m",
};

export function success(data = [], meta = {}) {
  return {
    success: true,
    data: Array.isArray(data) ? data : [],
    meta,
  };
}

export function failure(message = "Unknown error") {
  return {
    success: false,
    data: [],
    error: message,
  };
}
