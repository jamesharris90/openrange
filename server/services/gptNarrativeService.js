const { callGPT } = require('./gptService');

function safeText(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildFallbackNarrative(decision) {
  return {
    why_this_matters: safeText(
      decision.why,
      `${decision.symbol} does not have a confirmed edge right now.`
    ),
    what_to_do: safeText(
      decision.how,
      decision.tradeable ? 'Wait for the setup to confirm before entering.' : 'Stand aside until the setup materially improves.'
    ),
    what_to_avoid: safeText(
      decision.risk,
      'Avoid forcing size into unclear or low-conviction conditions.'
    ),
    source: 'deterministic_fallback',
    locked: true,
  };
}

function normalizeNarrativePayload(raw, fallback) {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    return {
      why_this_matters: safeText(parsed.why_this_matters, fallback.why_this_matters),
      what_to_do: safeText(parsed.what_to_do, fallback.what_to_do),
      what_to_avoid: safeText(parsed.what_to_avoid, fallback.what_to_avoid),
      source: 'gpt_augmented',
      locked: true,
    };
  } catch {
    return fallback;
  }
}

function buildPrompt(decision) {
  return [
    'You are augmenting a deterministic trading decision.',
    'You must explain the decision. You must not change it.',
    'Return JSON only with keys: why_this_matters, what_to_do, what_to_avoid.',
    'Keep each value to one or two sentences.',
    'Do not contradict the provided fields.',
    JSON.stringify({
      symbol: decision.symbol,
      status: decision.status,
      tradeable: decision.tradeable,
      confidence: decision.confidence,
      bias: decision.bias,
      driver: decision.driver,
      setup: decision.setup,
      earnings_edge: decision.earnings_edge,
      risk_flags: decision.risk_flags,
      why: decision.why,
      how: decision.how,
      risk: decision.risk,
    }),
  ].join('\n');
}

async function buildDecisionNarrative(decision, options = {}) {
  const fallback = buildFallbackNarrative(decision);
  if (options.allowRemote === false) {
    return fallback;
  }

  try {
    const response = await callGPT(buildPrompt(decision));
    return normalizeNarrativePayload(response, fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  buildDecisionNarrative,
};
