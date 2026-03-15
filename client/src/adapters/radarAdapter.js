function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function adaptRadarPayload(payload = {}) {
  const root = safeObject(payload);
  const data = safeObject(root.data);

  const opportunities = safeArray(data.opportunities).length
    ? safeArray(data.opportunities)
    : safeArray(root.opportunities);

  const signals = safeArray(data.signals).length
    ? safeArray(data.signals)
    : safeArray(root.signals);

  const news = safeArray(data.news).length
    ? safeArray(data.news)
    : safeArray(root.news);

  const sectors = safeArray(data.sectors).length
    ? safeArray(data.sectors)
    : safeArray(root.sectors);

  const summary = safeObject(data.summary && Object.keys(data.summary).length ? data.summary : root.summary);

  return {
    summary,
    opportunities,
    signals,
    news,
    sectors,
  };
}
