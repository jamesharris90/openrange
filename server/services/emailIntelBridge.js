const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');

function inferSentiment(headline = '') {
  const h = String(headline).toLowerCase();
  if (/beat|surge|rally|upgrade|growth|record|bullish/.test(h)) return 'positive';
  if (/miss|drop|plunge|downgrade|warning|lawsuit|bearish/.test(h)) return 'negative';
  return 'neutral';
}

function parseTicker(text = '') {
  const upper = String(text || '').toUpperCase();
  const direct = upper.match(/\$([A-Z]{1,5})\b/);
  if (direct?.[1]) return direct[1];

  const inParens = upper.match(/\(([A-Z]{1,5})\)/);
  if (inParens?.[1]) return inParens[1];

  const generic = upper.match(/\b([A-Z]{2,5})\b/);
  return generic?.[1] || null;
}

function toBridgePayload(email) {
  const sender = String(email?.sender || '').trim();
  const subject = String(email?.subject || '').trim();
  const rawText = String(email?.raw_text || '').trim();
  const sourceTag = String(email?.source_tag || '').trim() || 'newsletter';

  const headline = subject || rawText.split('\n').find((line) => line.trim()) || 'Newsletter update';
  const summary = rawText
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  const ticker = parseTicker(`${subject} ${rawText}`);
  const source = sender || sourceTag || 'newsletter';
  const publishedAt = email?.received_at || new Date().toISOString();
  const stableHash = crypto
    .createHash('sha256')
    .update(`${sender}|${subject}|${publishedAt}|${summary}`)
    .digest('hex')
    .slice(0, 24);

  return {
    ticker,
    headline,
    summary,
    source,
    timestamp: publishedAt,
    url: `internal://email-intel/${stableHash}`,
  };
}

async function bridgeNewsletterEmailToIntelNews(emailRow) {
  const sourceTag = String(emailRow?.source_tag || '').toLowerCase();
  if (!sourceTag.includes('newsletter') && !sourceTag.includes('digest')) {
    return { bridged: false, reason: 'source_tag_not_newsletter' };
  }

  const payload = toBridgePayload(emailRow);

  await queryWithTimeout(
    `INSERT INTO intel_news (
      symbol,
      headline,
      source,
      url,
      published_at,
      sentiment,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (url)
    DO UPDATE SET
      symbol = EXCLUDED.symbol,
      headline = EXCLUDED.headline,
      source = EXCLUDED.source,
      published_at = EXCLUDED.published_at,
      sentiment = EXCLUDED.sentiment,
      updated_at = now()`,
    [
      payload.ticker,
      payload.summary ? `${payload.headline} - ${payload.summary}` : payload.headline,
      payload.source,
      payload.url,
      payload.timestamp,
      inferSentiment(payload.headline),
    ],
    { timeoutMs: 5000, label: 'services.email_intel_bridge.upsert', maxRetries: 0 }
  );

  return {
    bridged: true,
    ...payload,
  };
}

module.exports = {
  bridgeNewsletterEmailToIntelNews,
};
