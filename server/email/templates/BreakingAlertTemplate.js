const { renderEmailLayout, esc } = require('./EmailLayout');

function renderBreakingAlertTemplate(payload = {}) {
  const symbol = esc(payload.symbol || 'N/A');
  const chartUrl = payload.chartUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`;

  const body = `
    <div style="font-size:14px;color:#e2e8f0;font-weight:700;margin-bottom:10px;">Breaking Trade Alert: ${symbol}</div>
    <img src="${chartUrl}" alt="${symbol} chart" width="100%" style="display:block;border-radius:8px;border:1px solid #1f2937;" />
    <div style="margin-top:10px;font-size:13px;color:#cbd5e1;line-height:1.6;">
      <div><strong>Catalyst:</strong> ${esc(payload.catalyst || 'Catalyst pending')}</div>
      <div><strong>Momentum:</strong> ${esc(payload.momentum || 'Momentum breakout profile detected')}</div>
      <div><strong>Trade plan:</strong> ${esc(payload.tradePlan || 'Entry on confirmation, define risk at invalidation.')}</div>
    </div>
    <div style="margin-top:10px;"><a href="https://openrangetrading.co.uk/charts/${encodeURIComponent(symbol)}" style="color:#38bdf8;text-decoration:none;">Open live chart</a></div>
  `;

  return renderEmailLayout({
    title: payload.title || 'Breaking Trade Alert',
    preheader: payload.preheader || `${symbol} triggered a high-conviction breakout`,
    bodyHtml: body,
  });
}

module.exports = {
  renderBreakingAlertTemplate,
};
