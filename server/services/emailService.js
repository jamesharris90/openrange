const { Resend } = require('resend');
const logger = require('../logger');

function getRecipients() {
  const configured = String(process.env.MORNING_BRIEF_RECIPIENTS || process.env.RESEND_TO || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundScore(value) {
  return Math.round(toNumber(value, 0));
}

function tickerLink(symbol) {
  const safe = encodeURIComponent(String(symbol || '').toUpperCase());
  return `https://openrangetrading.co.uk/cockpit?symbol=${safe}`;
}

function formatCatalystType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return 'Catalyst';
  if (normalized === 'earnings') return 'Earnings Beat';
  if (normalized === 'fda approval') return 'FDA Approval';
  return normalized.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function dedupeSignals(signals = []) {
  const bestBySymbol = new Map();
  for (const row of signals) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const score = toNumber(row?.score, 0);
    const existing = bestBySymbol.get(symbol);
    if (!existing || score > toNumber(existing.score, 0)) {
      bestBySymbol.set(symbol, { ...row, symbol, score });
    }
  }
  return Array.from(bestBySymbol.values()).sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0));
}

function marketRowBySymbol(rows = [], symbol) {
  return rows.find((row) => String(row?.symbol || '').toUpperCase() === symbol) || null;
}

function buildBriefingHtml(briefing) {
  const createdAt = briefing?.createdAt || new Date().toISOString();
  const narrative = briefing?.narrative || {};
  const signals = dedupeSignals(Array.isArray(briefing?.signals) ? briefing.signals : []);
  const stocksInPlay = Array.isArray(briefing?.stocksInPlay) ? briefing.stocksInPlay : [];
  const topCatalysts = Array.isArray(briefing?.topCatalysts) ? briefing.topCatalysts : [];
  const market = Array.isArray(briefing?.market) ? briefing.market : [];
  const news = Array.isArray(briefing?.news) ? briefing.news : [];
  const sectorStrength = Array.isArray(briefing?.sectorStrength) ? briefing.sectorStrength : [];
  const earningsToday = Array.isArray(briefing?.earningsToday) ? briefing.earningsToday : [];
  const macroMap = Array.isArray(briefing?.macroMap) ? briefing.macroMap : [];
  const tradeIdea = briefing?.tradeIdea || stocksInPlay[0] || null;
  const marketRegime = briefing?.marketRegime || 'Neutral';
  const focusText = briefing?.focusText || 'Opportunity scan active. Prioritize high conviction setups.';

  const spy = marketRowBySymbol(market, 'SPY');
  const qqq = marketRowBySymbol(market, 'QQQ');
  const vix = marketRowBySymbol(market, 'VIX');

  const topSignalsRows = signals.slice(0, 10).map((row) => {
    const link = tickerLink(row.symbol);
    const rvolFromSignal = toNumber(row?.rvol, NaN);
    const rvolFromSip = toNumber(stocksInPlay.find((s) => s.symbol === row.symbol)?.rvol, NaN);
    const rvol = Number.isFinite(rvolFromSignal) ? rvolFromSignal : (Number.isFinite(rvolFromSip) ? rvolFromSip : 0);
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;"><a href="${link}" style="color:#38bdf8;text-decoration:none;font-weight:700;">${row.symbol}</a></td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${row.strategy || 'Setup'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:#f8fafc;font-weight:700;">${roundScore(row.score)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${rvol.toFixed(2)}</td>
      </tr>`;
  }).join('');

  const sectorRows = sectorStrength.slice(0, 3).map((row) =>
    `<li style="margin:0 0 6px 18px;color:#dbeafe;">${row.sector || 'Unknown Sector'}</li>`
  ).join('') || '<li style="margin:0 0 6px 18px;color:#94a3b8;">Sector strength unavailable</li>';

  const catalystsRows = topCatalysts.slice(0, 5).map((row) => {
    const symbol = row?.symbol || 'N/A';
    const type = formatCatalystType(row?.catalyst_type);
    const impact = roundScore(row?.impact_score);
    const headline = String(row?.headline || '').trim() || 'No headline available';
    return `<li style="margin:0 0 10px 18px;color:#dbeafe;"><div><a href="${tickerLink(symbol)}" style="color:#38bdf8;text-decoration:none;">${symbol}</a> &mdash; ${type} (Impact ${impact})</div><div style="margin-top:2px;color:#93c5fd;">&quot;${headline}&quot;</div></li>`;
  }).join('') || (narrative.catalysts || []).slice(0, 6).map((item) =>
    `<li style="margin:0 0 6px 18px;color:#dbeafe;">${item}</li>`
  ).join('') || '<li style="margin:0 0 6px 18px;color:#94a3b8;">No catalysts available</li>';

  const newsRows = news.slice(0, 8).map((row) => {
    const url = row?.url || 'https://openrangetrading.co.uk/dashboard';
    return `<li style="margin:0 0 8px 18px;"><a href="${url}" style="color:#93c5fd;text-decoration:none;">${row.headline || 'Untitled'}</a></li>`;
  }).join('') || '<li style="margin:0 0 8px 18px;color:#94a3b8;">No news available</li>';

  const earningsRows = earningsToday.slice(0, 5).map((row) =>
    `<li style="margin:0 0 6px 18px;color:#dbeafe;">${row.symbol || ''}${row.company ? ` - ${row.company}` : ''}</li>`
  ).join('') || '<li style="margin:0 0 6px 18px;color:#94a3b8;">No earnings events today</li>';

  const macroLookup = (symbol, fallback = 'N/A') => {
    const found = marketRowBySymbol(macroMap, symbol) || marketRowBySymbol(market, symbol);
    if (!found) return fallback;
    const price = found.price == null ? 'N/A' : String(found.price);
    const change = toNumber(found.change_percent, 0).toFixed(2);
    return `${price} (${change}%)`;
  };

  const top3 = signals.slice(0, 3)
    .map((row) => `${row.symbol} (${roundScore(row.score)})`)
    .join(', ') || 'No top signals available';

  const preheader = `Today's top signals: ${top3}`;

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0;padding:0;background:#020617;font-family:Arial,sans-serif;color:#e2e8f0;">
      <tr>
        <td align="center" style="padding:16px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#0b1220;border:1px solid #1e293b;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px;background:#0f172a;border-bottom:1px solid #1f2937;">
                <div style="font-size:20px;font-weight:800;color:#38bdf8;">OpenRange</div>
                <div style="font-size:18px;font-weight:700;color:#f8fafc;margin-top:4px;">Morning Briefing</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:6px;">Generated ${createdAt}</div>
              </td>
            </tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Market Regime</div><div style="margin-top:8px;font-size:18px;font-weight:700;color:#f8fafc;">${marketRegime} ${marketRegime === 'Neutral' ? '⚖️' : ''}</div><div style="margin-top:10px;font-size:13px;color:#cbd5e1;">SPY: ${spy ? `${spy.price} (${toNumber(spy.change_percent, 0).toFixed(2)}%)` : 'N/A'} | QQQ: ${qqq ? `${qqq.price} (${toNumber(qqq.change_percent, 0).toFixed(2)}%)` : 'N/A'} | VIX: ${vix ? `${vix.price}` : 'N/A'}</div></td></tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Today's Focus</div><div style="margin-top:8px;font-size:14px;color:#dbeafe;line-height:1.5;">${focusText}</div></td></tr>
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #1f2937;">
                <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Top Signals</div>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;border-collapse:collapse;">
                  <tr>
                    <th align="left" style="padding:8px;color:#93c5fd;font-size:12px;border-bottom:1px solid #1f2937;">Ticker</th>
                    <th align="left" style="padding:8px;color:#93c5fd;font-size:12px;border-bottom:1px solid #1f2937;">Setup</th>
                    <th align="left" style="padding:8px;color:#93c5fd;font-size:12px;border-bottom:1px solid #1f2937;">Score</th>
                    <th align="left" style="padding:8px;color:#93c5fd;font-size:12px;border-bottom:1px solid #1f2937;">RVol</th>
                  </tr>
                  ${topSignalsRows}
                </table>
                <div style="margin-top:14px;">
                  <a href="https://openrangetrading.co.uk/dashboard" style="display:inline-block;background:#38bdf8;color:#0b1220;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;font-size:13px;">Open Your Dashboard -></a>
                  <a href="https://openrangetrading.co.uk/cockpit" style="display:inline-block;background:#1e293b;color:#e2e8f0;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;font-size:13px;margin-left:8px;">View Full Market Analysis -></a>
                </div>
              </td>
            </tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Sector Strength</div><ul style="margin:10px 0 0 0;padding:0;">${sectorRows}</ul><div style="margin-top:10px;"><a href="https://openrangetrading.co.uk/sector-heatmap" style="color:#38bdf8;text-decoration:none;font-size:13px;">View sector heatmap -></a></div></td></tr>
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #1f2937;">
                <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Trade Idea Of The Day</div>
                <div style="margin-top:10px;font-size:13px;color:#dbeafe;line-height:1.6;">
                  <div><strong>Ticker:</strong> ${tradeIdea?.symbol ? `<a href="${tickerLink(tradeIdea.symbol)}" style="color:#38bdf8;text-decoration:none;">${tradeIdea.symbol}</a>` : 'N/A'}</div>
                  <div><strong>Setup:</strong> ${tradeIdea?.setup || 'N/A'}</div>
                  <div><strong>Trigger:</strong> ${tradeIdea?.trigger || 'N/A'}</div>
                  <div><strong>Target:</strong> ${tradeIdea?.target || 'N/A'}</div>
                  <div><strong>Risk:</strong> ${tradeIdea?.risk || 'N/A'}</div>
                </div>
              </td>
            </tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Top Catalysts</div><ul style="margin:10px 0 0 0;padding:0;">${catalystsRows}</ul></td></tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Macro Map</div><div style="margin-top:10px;font-size:13px;color:#dbeafe;line-height:1.8;">Oil: ${macroLookup('USO')}<br/>Gold: ${macroLookup('GLD')}<br/>Bitcoin: ${macroLookup('BTCUSD')}<br/>DXY: ${macroLookup('DXY')}<br/>10Y: ${macroLookup('TNX', macroLookup('^TNX'))}</div></td></tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">Earnings Today</div><ul style="margin:10px 0 0 0;padding:0;">${earningsRows}</ul></td></tr>
            <tr><td style="padding:18px 20px;border-bottom:1px solid #1f2937;"><div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;">News Pulse</div><ul style="margin:10px 0 0 0;padding:0;">${newsRows}</ul></td></tr>
            <tr>
              <td style="padding:18px 20px;background:#0f172a;">
                <div style="font-size:14px;font-weight:700;color:#f8fafc;">OpenRange Trading</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Discover opportunity faster. Trade with intelligence.</div>
                <div style="margin-top:10px;font-size:12px;">
                  <a href="https://openrangetrading.co.uk/dashboard" style="color:#93c5fd;text-decoration:none;margin-right:10px;">Dashboard</a>
                  <a href="https://openrangetrading.co.uk/scanner" style="color:#93c5fd;text-decoration:none;margin-right:10px;">Scanner</a>
                  <a href="https://openrangetrading.co.uk/cockpit" style="color:#93c5fd;text-decoration:none;margin-right:10px;">Cockpit</a>
                  <a href="https://openrangetrading.co.uk/unsubscribe" style="color:#64748b;text-decoration:none;">Unsubscribe</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildBriefingText(briefing) {
  const narrative = briefing?.narrative || {};
  const topCatalystsText = (briefing?.topCatalysts || []).slice(0, 5).map((row) => {
    const symbol = row?.symbol || 'N/A';
    const type = formatCatalystType(row?.catalyst_type);
    const impact = roundScore(row?.impact_score);
    const headline = String(row?.headline || '').trim() || 'No headline available';
    return `${symbol} -- ${type} (Impact ${impact})\n"${headline}"`;
  });
  const signalList = dedupeSignals(briefing?.signals || [])
    .slice(0, 6)
    .map((row) => `${row.symbol || 'N/A'} (${roundScore(row.score)})`)
    .join(', ');

  return [
    'OpenRange Morning Briefing',
    `Generated: ${briefing?.createdAt || new Date().toISOString()}`,
    '',
    `Overview: ${narrative.overview || 'No overview generated.'}`,
    `Risk: ${narrative.risk || 'No risk summary generated.'}`,
    `Watchlist: ${(narrative.watchlist || []).join(', ') || 'None'}`,
    `Top Signals: ${signalList || 'None'}`,
    `Top Stocks In Play: ${(briefing?.stocksInPlay || []).slice(0, 5).map((row) => row.symbol).join(', ') || 'None'}`,
    'Top Catalysts:',
    ...(topCatalystsText.length ? topCatalystsText : ['None']),
  ].join('\n');
}

async function sendBriefingEmail(briefing, recipientOverride) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('[BRIEFING_EMAIL] RESEND_API_KEY missing; skipping email send');
    return { sent: false, reason: 'missing_resend_api_key' };
  }

  const recipients = recipientOverride ? [recipientOverride] : getRecipients();
  if (!recipients.length) {
    logger.warn('[BRIEFING_EMAIL] No recipients configured; skipping email send');
    return { sent: false, reason: 'missing_recipients' };
  }

  const from = process.env.EMAIL_FROM || 'OpenRange <briefing@openrange.local>';
  const resend = new Resend(apiKey);

  const response = await resend.emails.send({
    from,
    to: recipients,
    subject: `OpenRange Morning Briefing - ${new Date().toISOString().slice(0, 10)}`,
    html: buildBriefingHtml(briefing),
    text: buildBriefingText(briefing),
  });

  console.log('EMAIL RESPONSE:', response);

  logger.info('[BRIEFING_EMAIL] Sent', {
    recipients,
    rawResponse: response,
    id: response?.data?.id || null,
  });

  return {
    sent: true,
    recipients,
    providerId: response?.data?.id || null,
  };
}

module.exports = {
  sendBriefingEmail,
};
