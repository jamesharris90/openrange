/**
 * Generate trader narrative for a Beacon v0 pick.
 *
 * Input: pick object with symbol, pattern, signals_aligned, reasoning,
 *        and optional context (news, earnings, congressional).
 * Output: { thesis, watch_for } or null fields if generation failed.
 */

const { generateJSON, MODEL } = require('../../services/anthropicClient');

const SYSTEM_PROMPT = `You are analysing a stock pick from an algorithmic trading system called Beacon. Your role is to translate factual signal data into a trader's perspective on what the setup means and what to watch.

You are NOT a financial advisor. You do NOT give buy/sell recommendations. You do NOT predict prices. You explain what the data shows.

Style: concise, direct, trader vernacular. No hedging language ("might", "could potentially"). No disclaimers. No emoji. No filler.

OUTPUT a JSON object with exactly this shape:
{
  "thesis": "1-2 sentences explaining what the alignment means in trader terms. Focus on WHY these signals firing together matters, not WHAT each one says.",
  "watch_for": "1 sentence on the key thing a trader would watch — technical level, news outcome, time-based event, or confirmation signal."
}

Rules:
- No price predictions or targets
- No directional calls ("this will go up")
- No financial advice language
- If signals are mixed or contradictory, say so
- Maximum 60 words total across both fields
- Plain text only, no markdown or formatting in the values
- Output ONLY the JSON object, nothing else

CONGRESSIONAL SIGNAL LANGUAGE:
When a pick includes congressional trade signals, describe them with factual, neutral language only.

USE: "disclosed congressional buying", "filed congressional activity", "congressional purchase disclosure", "notable disclosed positioning"

NEVER USE: "informed positioning", "smart money following politicians", any phrasing that implies politicians have inside information or that following them produces alpha.

State the disclosure as a data point, not a recommendation.`;

function buildUserMessage(pick, context = {}) {
  const lines = [
    'PICK DATA:',
    `Symbol: ${pick.symbol}`,
    `Pattern: ${pick.pattern || pick.pattern_label || 'Multi-Signal Alignment'}`,
    `Alignment count: ${pick.signals_aligned?.length || 0} signals`,
    `Reasoning: ${pick.reasoning || ''}`,
  ];

  if (context.news_headlines && context.news_headlines.length > 0) {
    lines.push('');
    lines.push('Top news headlines (last 12h):');
    context.news_headlines.slice(0, 2).forEach((headline, index) => {
      lines.push(`${index + 1}. ${headline}`);
    });
  }

  if (context.earnings_summary) {
    lines.push('');
    lines.push(`Earnings context: ${context.earnings_summary}`);
  }

  if (context.congressional_summary) {
    lines.push('');
    lines.push(`Congressional activity: ${context.congressional_summary}`);
  }

  return lines.join('\n');
}

function validateNarrative(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (typeof parsed.thesis !== 'string' || parsed.thesis.trim().length === 0) return false;
  if (typeof parsed.watch_for !== 'string' || parsed.watch_for.trim().length === 0) return false;

  const totalWords = `${parsed.thesis} ${parsed.watch_for}`.trim().split(/\s+/).filter(Boolean).length;
  if (totalWords > 100) return false;

  return true;
}

/**
 * Generate narrative for a single pick.
 *
 * @param {object} pick - Beacon v0 pick object
 * @param {object} context - Optional enrichment (news, earnings, congressional)
 * @returns {Promise<{ thesis: string|null, watch_for: string|null, model: string, input_tokens: number, output_tokens: number, error: string|null }>}
 */
async function generatePickNarrative(pick, context = {}) {
  const userMessage = buildUserMessage(pick, context);
  const { result, usage, error } = await generateJSON(SYSTEM_PROMPT, userMessage);

  if (error) {
    return {
      thesis: null,
      watch_for: null,
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      error,
    };
  }

  if (!validateNarrative(result)) {
    return {
      thesis: null,
      watch_for: null,
      model: MODEL,
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
      error: `narrative validation failed: ${JSON.stringify(result).substring(0, 200)}`,
    };
  }

  return {
    thesis: result.thesis.trim(),
    watch_for: result.watch_for.trim(),
    model: MODEL,
    input_tokens: usage?.input_tokens || 0,
    output_tokens: usage?.output_tokens || 0,
    error: null,
  };
}

module.exports = {
  generatePickNarrative,
  buildUserMessage,
  validateNarrative,
  SYSTEM_PROMPT,
};
