const OpenAI = require('openai');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function fallbackNarrative(row) {
  return [
    `${row.symbol} printed a ${row.catalyst_type} catalyst with ${row.provider_count} confirming sources.`,
    `Freshness is ${row.freshness_minutes} minutes and sentiment score is ${row.sentiment_score}.`,
    `Sector trend is ${row.sector_trend} while market trend is ${row.market_trend}.`,
    `Expected move range is ${row.expected_move_low} to ${row.expected_move_high} with confidence ${row.confidence_score}.`,
  ].join(' ');
}

async function fetchRowsNeedingNarrative(limit = 80) {
  const { rows } = await queryWithTimeout(
    `SELECT
       ci.id,
       ci.news_id,
       ci.symbol,
       ce.headline,
       ci.catalyst_type,
       ci.provider_count,
       ci.freshness_minutes,
       ci.sector,
       ci.sector_trend,
       ci.market_trend,
       ci.sentiment_score,
       ci.expected_move_low,
       ci.expected_move_high,
       ci.confidence_score
     FROM catalyst_intelligence ci
     LEFT JOIN catalyst_events ce
       ON ce.news_id = ci.news_id
     WHERE COALESCE(ci.narrative, '') = ''
     ORDER BY ci.created_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 10000, label: 'catalyst_narrative.fetch_pending', maxRetries: 1 }
  );

  return rows;
}

async function generateNarrative(client, row) {
  if (!client) {
    return fallbackNarrative(row);
  }

  const prompt = [
    'Explain in clear language:',
    '• what the news is',
    '• why it matters',
    '• expected price reaction',
    '• sector and market context',
    '• probability of continuation',
    '',
    `Symbol: ${row.symbol}`,
    `Headline: ${row.headline || 'N/A'}`,
    `Catalyst Type: ${row.catalyst_type}`,
    `Provider Count: ${row.provider_count}`,
    `Freshness Minutes: ${row.freshness_minutes}`,
    `Sector: ${row.sector || 'Unknown'}`,
    `Sector Trend: ${row.sector_trend}`,
    `Market Trend: ${row.market_trend}`,
    `Sentiment Score: ${row.sentiment_score}`,
    `Expected Move Low: ${row.expected_move_low}`,
    `Expected Move High: ${row.expected_move_high}`,
    `Confidence Score: ${row.confidence_score}`,
  ].join('\n');

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are OpenRange Catalyst Narrative MCP. Return concise narrative text only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const text = String(response?.choices?.[0]?.message?.content || '').trim();
    return text || fallbackNarrative(row);
  } catch (error) {
    logger.warn('[CATALYST_NARRATIVE] mcp generation failed, using fallback', {
      news_id: row.news_id,
      symbol: row.symbol,
      error: error.message,
    });
    return fallbackNarrative(row);
  }
}

async function updateNarrative(id, narrative) {
  await queryWithTimeout(
    `UPDATE catalyst_intelligence
     SET narrative = $2
     WHERE id = $1`,
    [id, narrative],
    { timeoutMs: 7000, label: 'catalyst_narrative.update', maxRetries: 0 }
  );
}

async function runCatalystNarrativeEngine() {
  try {
    const rows = await fetchRowsNeedingNarrative();
    const client = getOpenAiClient();

    let updated = 0;
    for (const row of rows) {
      const narrative = await generateNarrative(client, row);
      await updateNarrative(row.id, narrative);
      updated += 1;
    }

    const result = {
      scanned: rows.length,
      updated,
      narrativeGenerationActive: Boolean(client),
    };
    logger.info('[CATALYST_NARRATIVE] completed', result);
    return result;
  } catch (error) {
    logger.error('[CATALYST_NARRATIVE] failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCatalystNarrativeEngine,
};
