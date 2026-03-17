const { renderEmailLayout, esc } = require('./EmailLayout');

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function formatMarketValue(value, isPercent = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return isPercent ? formatPercent(n) : n.toFixed(2);
}

function renderStocksInPlayCard(row = {}) {
  const symbol = esc(row.symbol || 'N/A');
  const logoUrl = row.logo || `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}`;
  const chartUrl = row.chartImage || row.chartUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`;
  const chartLink = `https://openrangetrading.co.uk/charts/${encodeURIComponent(symbol)}`;
  const relativeVolume = formatNumber(row.relative_volume, 2);
  const priceChange = formatPercent(row.price_change_percent);
  const price = Number.isFinite(Number(row.price)) ? `$${Number(row.price).toFixed(2)}` : '—';
  const narrative = row.narrative || {};
  const tradeScore = Number.isFinite(Number(row.tradeScore)) ? `${Math.round(Number(row.tradeScore))}` : '—';
  const scoreValue = Number.isFinite(Number(row.tradeScore)) ? Math.max(0, Math.min(100, Math.round(Number(row.tradeScore)))) : 0;
  const grade = esc(row.grade || 'D');
  const winRate = Number.isFinite(Number(row?.strategyStats?.winRate))
    ? `${Number(row.strategyStats.winRate).toFixed(1)}%`
    : 'N/A';
  const confidence = esc(row.confidence || 'Low');
  const newsHeadline = esc(row?.news?.headline || row.catalyst || 'No news catalyst available.');
  const newsUrl = row?.news?.url ? String(row.news.url) : null;
  const stats = row.strategyStats || {};
  const probabilityContext = row.probabilityContext || [
    'Historical Setup Performance',
    `Win rate: ${Number.isFinite(Number(stats.winRate)) ? `${Number(stats.winRate).toFixed(1)}%` : 'N/A'}`,
    `Average continuation: ${Number.isFinite(Number(stats.avgMove)) ? `${Number(stats.avgMove) >= 0 ? '+' : ''}${Number(stats.avgMove).toFixed(2)}%` : 'N/A'}`,
    `Average drawdown: ${Number.isFinite(Number(stats.avgDrawdown)) ? `${Number(stats.avgDrawdown) >= 0 ? '+' : ''}${Number(stats.avgDrawdown).toFixed(2)}%` : 'N/A'}`,
    `Sample size: ${Number.isFinite(Number(stats.sampleSize)) ? `${Number(stats.sampleSize)} signals` : 'N/A'}`,
  ].join('\n');
  const probabilityHtml = String(probabilityContext || 'Historical performance data building')
    .split('\n')
    .map((line) => esc(line))
    .join('<br />');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #1f2937;border-radius:10px;background:#0f172a;margin-bottom:14px;overflow:hidden;">
      <tr>
        <td style="padding:12px;border-bottom:1px solid #1f2937;">
          <table role="presentation" width="100%"><tr>
            <td style="vertical-align:middle;">
              <img src="${logoUrl}" alt="${symbol} logo" width="60" style="max-width:60px;width:60px;height:60px;border-radius:50%;vertical-align:middle;background:#fff;margin-right:8px;object-fit:contain;" />
              <span style="font-size:18px;font-weight:700;color:#f8fafc;vertical-align:middle;">${symbol}</span>
            </td>
            <td align="right" style="font-size:12px;color:#93c5fd;">
              <div>Price ${price}</div>
              <div>RVOL ${relativeVolume}</div>
              <div>Move ${priceChange}</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:12px;color:#cbd5e1;font-size:13px;line-height:1.6;">
          <div style="margin:0 0 8px 0;"><span style="display:inline-block;background:#1e3a8a;color:#dbeafe;padding:5px 9px;border-radius:999px;font-weight:700;">Trade Score ${tradeScore} (${grade})</span> <span style="margin-left:8px;"><strong style="color:#e2e8f0;">Strategy win rate:</strong> ${winRate}</span></div>
          <div style="margin:0 0 8px 0;"><strong style="color:#e2e8f0;">Confidence:</strong> ${confidence}</div>
          <div style="margin:0 0 10px 0;">
            <div style="height:8px;background:#1f2937;border-radius:999px;overflow:hidden;">
              <div style="height:8px;width:${scoreValue}%;background:#38bdf8;"></div>
            </div>
          </div>
          <div style="margin:0 0 8px 0;padding:10px;border:1px solid #334155;border-radius:8px;background:#0b1220;color:#cbd5e1;">
            ${probabilityHtml || 'Historical performance data building'}
          </div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">News:</strong> ${newsUrl ? `<a href="${esc(newsUrl)}" style="color:#38bdf8;text-decoration:none;">${newsHeadline}</a>` : newsHeadline}</div>
          <div><strong style="color:#e2e8f0;">Why moving:</strong> ${esc(narrative.whyMoving || row.catalyst || 'No catalyst summary available.')}</div>
          <div><strong style="color:#e2e8f0;">Why tradeable:</strong> ${esc(narrative.whyTradeable || row.setupType || 'Structure quality currently acceptable for active monitoring.')}</div>
          <div><strong style="color:#e2e8f0;">How to trade:</strong> ${esc(narrative.howToTrade || 'Wait for confirmation at key levels before entry.')}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Risk:</strong> ${esc(narrative.risk || 'Define invalidation before entry')} | <strong style="color:#e2e8f0;">Target:</strong> ${esc(narrative.target || 'Scale at 1R and trail')}</div>
          <div style="margin-top:8px;"><a href="https://openrangetrading.co.uk/charts/${encodeURIComponent(symbol)}" style="color:#38bdf8;text-decoration:none;">Open ${symbol} chart</a></div>
          <div style="margin-top:10px;"><a href="https://openrangetrading.co.uk/radar?symbol=${encodeURIComponent(symbol)}" style="display:inline-block;background:#38bdf8;color:#0b1220;text-decoration:none;padding:8px 12px;border-radius:8px;font-weight:700;">Open in Radar</a></div>
        </td>
      </tr>
      <tr>
        <td style="padding:0;">
          <a href="${chartLink}"><img src="${chartUrl}" alt="${symbol} chart" width="100%" style="display:block;border:0;" /></a>
        </td>
      </tr>
    </table>`;
}

function renderBeaconMorningTemplate(payload = {}) {
  const marketContext = payload.marketContext || {};
  const stockOfDay = payload.stockOfDay || null;
  const secondary = Array.isArray(payload.secondaryOpportunities)
    ? payload.secondaryOpportunities
    : (Array.isArray(payload.stocksInPlay) ? payload.stocksInPlay.filter((row) => !row.stockOfTheDay) : []);
  const stockOfDayCard = stockOfDay ? renderStocksInPlayCard(stockOfDay) : '';
  const secondaryCards = secondary.map((row) => renderStocksInPlayCard(row)).join('');
  const fallbackMessage = payload.fallbackMessage
    ? `<div style="padding:10px 12px;border:1px solid #334155;background:#0b1220;color:#cbd5e1;border-radius:8px;margin-bottom:12px;">${esc(payload.fallbackMessage)}</div>`
    : '';
  const topMovers = Array.isArray(marketContext.topMovers) ? marketContext.topMovers : [];
  const radarThemes = Array.isArray(marketContext.radarThemes) ? marketContext.radarThemes : [];

  const topMoversRows = topMovers
    .map((row) => `
      <tr>
        <td style="padding:7px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${esc(row.symbol || 'N/A')}</td>
        <td style="padding:7px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${Number.isFinite(Number(row.price)) ? `$${Number(row.price).toFixed(2)}` : 'N/A'}</td>
        <td style="padding:7px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${formatPercent(row.change)}</td>
      </tr>
    `)
    .join('') || '<tr><td colspan="3" style="padding:7px;color:#94a3b8;">No mover data available.</td></tr>';

  const themesBlock = radarThemes.length > 0
    ? radarThemes.map((theme) => `<span style="display:inline-block;background:#1e293b;color:#cbd5e1;padding:6px 10px;border-radius:999px;margin:0 8px 8px 0;">${esc(theme)}</span>`).join('')
    : '<span style="color:#94a3b8;">No dominant radar themes detected.</span>';

  const marketPulseBlock = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1f2937;border-radius:10px;background:#0f172a;margin-bottom:14px;overflow:hidden;">
      <tr>
        <td style="padding:12px;border-bottom:1px solid #1f2937;color:#93c5fd;font-size:12px;font-weight:700;">Market Pulse</td>
      </tr>
      <tr>
        <td style="padding:12px;color:#cbd5e1;font-size:13px;line-height:1.6;">
          <div><strong style="color:#e2e8f0;">SPY:</strong> ${formatMarketValue(marketContext.spy, false)} | <strong style="color:#e2e8f0;">QQQ:</strong> ${formatMarketValue(marketContext.qqq, false)} | <strong style="color:#e2e8f0;">VIX:</strong> ${formatMarketValue(marketContext.vix, false)}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Overview:</strong> ${esc(marketContext.overview || 'No overview generated.')}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Risk:</strong> ${esc(marketContext.risk || 'No risk summary generated.')}</div>
        </td>
      </tr>
    </table>
  `;

  const fallbackCardMessage = '<div style="color:#94a3b8;margin-bottom:10px;">No qualified setup detected for this section.</div>';

  const tradePlan = stockOfDay?.narrative || {};
  const tradePlanBlock = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1f2937;border-radius:10px;background:#0f172a;margin-bottom:14px;overflow:hidden;">
      <tr>
        <td style="padding:12px;border-bottom:1px solid #1f2937;color:#93c5fd;font-size:12px;font-weight:700;">Trade Plan</td>
      </tr>
      <tr>
        <td style="padding:12px;color:#cbd5e1;font-size:13px;line-height:1.6;">
          <div><strong style="color:#e2e8f0;">How traders approach it:</strong> ${esc(tradePlan.howToTrade || 'Wait for confirmation before participating.')}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Risk:</strong> ${esc(tradePlan.risk || 'Define invalidation before entry.')}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Target:</strong> ${esc(tradePlan.target || 'Scale at 1R and trail into continuation.')}</div>
        </td>
      </tr>
    </table>
  `;

  const topMoversBlock = `
    <div style="font-size:14px;font-weight:700;color:#f8fafc;margin:8px 0 8px 0;">Top Movers</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0f172a;border:1px solid #1f2937;border-radius:10px;overflow:hidden;">
      <tr>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Symbol</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Price</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Move</th>
      </tr>
      ${topMoversRows}
    </table>
  `;

  const body = `
    <div style="font-size:20px;font-weight:800;color:#f8fafc;letter-spacing:0.2px;margin:0 0 12px 0;">OpenRange Beacon Intelligence Brief</div>
    ${marketPulseBlock}
    <div style="font-size:14px;font-weight:700;color:#f8fafc;margin:0 0 10px 0;">Today's Radar Themes</div>
    <div style="margin:0 0 12px 0;">${themesBlock}</div>
    ${fallbackMessage}
    <div style="font-size:14px;font-weight:700;color:#f8fafc;margin:0 0 10px 0;">Stock of the Day</div>
    ${stockOfDayCard || fallbackCardMessage}
    ${tradePlanBlock}
    <div style="font-size:14px;font-weight:700;color:#f8fafc;margin:8px 0 10px 0;">Secondary Watchlist</div>
    ${secondaryCards || fallbackCardMessage}
    ${topMoversBlock}
    <div style="margin-top:10px;font-size:13px;">
      <a href="https://openrangetrading.co.uk/radar" style="display:inline-block;background:#38bdf8;color:#0b1220;text-decoration:none;padding:9px 12px;border-radius:8px;font-weight:700;margin-right:8px;">Open Radar</a>
      <a href="https://openrangetrading.co.uk/opportunities" style="display:inline-block;background:#1e293b;color:#e2e8f0;text-decoration:none;padding:9px 12px;border-radius:8px;font-weight:700;">Open Opportunities</a>
    </div>
  `;

  return renderEmailLayout({
    title: payload.title || 'Beacon Morning Brief',
    preheader: payload.preheader || 'OpenRange top conviction setups for today',
    bodyHtml: body,
  });
}

module.exports = {
  renderBeaconMorningTemplate,
};
