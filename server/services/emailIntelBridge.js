const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');

const NEWSLETTER_PUBLISHERS = [
  'earnings whispers',
  'the fly',
  'marketwatch',
  'benzinga',
];

const TICKER_STOP_WORDS = new Set([
  'A', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BY', 'FOR', 'FROM', 'IN', 'INTO', 'IS', 'IT',
  'NEW', 'NOT', 'NOW', 'OF', 'ON', 'OR', 'OUT', 'THE', 'TO', 'US', 'USA', 'WAS', 'WITH',
]);

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

function parseTickers(text = '') {
  const value = String(text || '');
  const direct = value.match(/\$([A-Z]{1,5})\b/g) || [];
  const paren = value.match(/\(([A-Z]{1,5})\)/g) || [];
  const plain = value.match(/\b[A-Z]{2,5}\b/g) || [];
  const merged = [
    ...direct.map((token) => token.replace('$', '')),
    ...paren.map((token) => token.replace(/[()]/g, '')),
    ...plain,
  ]
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((value) => value && !TICKER_STOP_WORDS.has(value));
  return Array.from(new Set(merged));
}

function looksLikeTrackedNewsletter(email = {}) {
  const source = `${email?.source_name || ''} ${email?.sender || ''} ${email?.subject || ''}`.toLowerCase();
  return NEWSLETTER_PUBLISHERS.some((publisher) => source.includes(publisher));
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
  const source = String(email?.source_name || '').trim() || sender || sourceTag || 'newsletter';
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
  if (!sourceTag.includes('newsletter') && !sourceTag.includes('digest') && !looksLikeTrackedNewsletter(emailRow)) {
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

  const candidates = parseTickers(`${emailRow?.subject || ''} ${emailRow?.raw_text || ''}`);
  const tickers = candidates.length ? candidates : (payload.ticker ? [payload.ticker] : []);

  for (const symbol of tickers) {
    await queryWithTimeout(
      `INSERT INTO trade_catalysts (
         symbol,
         catalyst_type,
         headline,
         source,
         sentiment,
         published_at,
         score,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (symbol, headline, published_at, catalyst_type) DO UPDATE
       SET source = EXCLUDED.source,
           sentiment = EXCLUDED.sentiment,
           score = EXCLUDED.score,
           created_at = NOW()`,
      [
        symbol,
        'newsletter_intelligence',
        payload.headline,
        payload.source,
        inferSentiment(payload.headline),
        payload.timestamp,
        6,
      ],
      { timeoutMs: 5000, label: 'services.email_intel_bridge.catalyst_upsert', maxRetries: 0 }
    );
  }

  return {
    bridged: true,
    ...payload,
  };
}

module.exports = {
  bridgeNewsletterEmailToIntelNews,
};
