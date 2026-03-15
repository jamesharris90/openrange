const { renderEmailLayout, esc } = require('./EmailLayout');

function renderEarningsTemplate(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const rows = items.map((row) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${esc(row.symbol)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.earnings_date)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.expected_move || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.setup || 'Watch reaction')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="padding:8px;color:#94a3b8;">No earnings setups available.</td></tr>';

  const body = `
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;">Institutional earnings intelligence for the upcoming week.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0f172a;border:1px solid #1f2937;">
      <tr>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Ticker</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Date</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Expected Move</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Setup</th>
      </tr>
      ${rows}
    </table>
  `;

  return renderEmailLayout({
    title: payload.title || 'Earnings Intelligence',
    preheader: payload.preheader || 'Major earnings setups for this week',
    bodyHtml: body,
  });
}

module.exports = {
  renderEarningsTemplate,
};
