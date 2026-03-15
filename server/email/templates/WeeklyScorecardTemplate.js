const { renderEmailLayout, esc } = require('./EmailLayout');

function renderWeeklyScorecardTemplate(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const tableRows = rows.map((row) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${esc(row.symbol)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.entry)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.high)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.returnPct)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="padding:8px;color:#94a3b8;">No scorecard rows available.</td></tr>';

  const body = `
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;">Success rate: ${esc(payload.successRate || '—')} | Avg return: ${esc(payload.averageReturn || '—')}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0f172a;border:1px solid #1f2937;">
      <tr>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Ticker</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Entry</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">High</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Return</th>
      </tr>
      ${tableRows}
    </table>
  `;

  return renderEmailLayout({
    title: payload.title || 'Weekly Scorecard',
    preheader: payload.preheader || 'Performance recap of Beacon picks',
    bodyHtml: body,
  });
}

module.exports = {
  renderWeeklyScorecardTemplate,
};
