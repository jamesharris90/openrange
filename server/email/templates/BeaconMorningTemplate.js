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

function renderTickerCard(row = {}) {
  const symbol = esc(row.symbol || 'N/A');
  const logoUrl = `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=pk_SQOvW8fXSneRoeWjokxVEA&retina=true`;
  const chartUrl = row.chartUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`;
  const chartLink = `https://openrangetrading.co.uk/charts/${encodeURIComponent(symbol)}`;
  const beaconScore = formatNumber(row.beacon_probability, 2);
  const expectedMove = formatPercent(row.expected_move);

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #1f2937;border-radius:10px;background:#0f172a;margin-bottom:14px;overflow:hidden;">
      <tr>
        <td style="padding:12px;border-bottom:1px solid #1f2937;">
          <table role="presentation" width="100%"><tr>
            <td style="vertical-align:middle;">
              <img src="${logoUrl}" alt="${symbol} logo" width="28" height="28" style="border-radius:50%;vertical-align:middle;background:#fff;margin-right:8px;" />
              <span style="font-size:18px;font-weight:700;color:#f8fafc;vertical-align:middle;">${symbol}</span>
            </td>
            <td align="right" style="font-size:12px;color:#93c5fd;">
              Beacon ${beaconScore} | Move ${expectedMove}
            </td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td style="padding:0;">
          <a href="${chartLink}"><img src="${chartUrl}" alt="${symbol} chart" width="100%" style="display:block;border:0;" /></a>
        </td>
      </tr>
      <tr>
        <td style="padding:12px;color:#cbd5e1;font-size:13px;line-height:1.6;">
          <div><strong style="color:#e2e8f0;">Why it is moving:</strong> ${esc(row.why_moving || row.catalyst_headline || 'No catalyst summary available.')}</div>
          <div><strong style="color:#e2e8f0;">Why it is tradeable:</strong> ${esc(row.why_tradeable || row.setup_reasoning || 'Structure quality currently acceptable for active monitoring.')}</div>
          <div><strong style="color:#e2e8f0;">Trade plan:</strong> ${esc(row.how_to_trade || 'Wait for confirmation at key levels before entry.')}</div>
          <div style="margin-top:6px;"><strong style="color:#e2e8f0;">Entry:</strong> ${esc(row.tradePlan?.entry || 'Break above opening range')} | <strong style="color:#e2e8f0;">Stop:</strong> ${esc(row.tradePlan?.stop || 'Below VWAP')} | <strong style="color:#e2e8f0;">Targets:</strong> ${esc(row.tradePlan?.targets || '1R, 2R')}</div>
          <div style="margin-top:8px;"><a href="https://openrangetrading.co.uk/charts/${encodeURIComponent(symbol)}" style="color:#38bdf8;text-decoration:none;">Open ${symbol} chart</a></div>
        </td>
      </tr>
    </table>`;
}

function renderBeaconMorningTemplate(payload = {}) {
  const market = payload.market || {};
  const setups = Array.isArray(payload.setups) ? payload.setups : [];
  const cards = setups.map((row) => renderTickerCard(row)).join('') || '<div style="color:#94a3b8;">No qualifying A+ setups available.</div>';

  const body = `
    <div style="font-size:13px;color:#cbd5e1;line-height:1.6;margin-bottom:12px;">
      <strong style="color:#f8fafc;">Market Snapshot:</strong>
      SPY ${formatPercent(market.spy)},
      QQQ ${formatPercent(market.qqq)},
      VIX ${formatNumber(market.vix, 2)}
    </div>
    ${cards}
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
