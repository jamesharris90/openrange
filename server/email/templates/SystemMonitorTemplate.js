const { renderEmailLayout, esc } = require('./EmailLayout');

function renderSystemMonitorTemplate(payload = {}) {
  const engines = Array.isArray(payload.engines) ? payload.engines : [];
  const engineRows = engines.map((row) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${esc(row.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.status)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.lagSeconds)}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="padding:8px;color:#94a3b8;">No engine data available.</td></tr>';

  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const alertRows = alerts.map((row) => `<li style="margin:0 0 6px 18px;color:#fca5a5;">${esc(row)}</li>`).join('') || '<li style="margin:0 0 6px 18px;color:#94a3b8;">No active alerts.</li>';

  const body = `
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;">API latency: ${esc(payload.apiLatency || '—')} | DB latency: ${esc(payload.dbLatency || '—')} | Error count: ${esc(payload.errorCount || '0')}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0f172a;border:1px solid #1f2937;">
      <tr>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Engine</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Status</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Lag (s)</th>
      </tr>
      ${engineRows}
    </table>
    <div style="margin-top:10px;font-size:13px;color:#cbd5e1;">Alerts:</div>
    <ul style="margin:6px 0 0 0;padding:0;">${alertRows}</ul>
  `;

  return renderEmailLayout({
    title: payload.title || 'System Monitor',
    preheader: payload.preheader || 'Daily OpenRange system monitor report',
    bodyHtml: body,
  });
}

module.exports = {
  renderSystemMonitorTemplate,
};
