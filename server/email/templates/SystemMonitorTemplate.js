const { renderEmailLayout, esc } = require('./EmailLayout');

function severityColor(value) {
  const s = String(value || '').toUpperCase();
  if (s.includes('CRITICAL')) return '#ef4444';
  if (s.includes('WARNING')) return '#f59e0b';
  return '#94a3b8';
}

function renderSystemMonitorTemplate(payload = {}) {
  const engineHealth = Array.isArray(payload.engineHealth)
    ? payload.engineHealth
    : (Array.isArray(payload.engines) ? payload.engines.map((row) => ({
      engine: row.name,
      status: row.status,
      lag: row.lagSeconds,
    })) : []);

  const engineRows = engineHealth.map((row) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#e2e8f0;">${esc(row.engine)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.status)}</td>
      <td style="padding:8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">${esc(row.lag)}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="padding:8px;color:#94a3b8;">No engine data available.</td></tr>';

  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const alertRows = alerts.map((row) => {
    const color = severityColor(row);
    return `<li style="margin:0 0 6px 18px;color:${color};font-weight:700;">${esc(row)}</li>`;
  }).join('') || '<li style="margin:0 0 6px 18px;color:#94a3b8;">No active alerts.</li>';

  const dataFreshness = esc(payload.dataFreshness || payload.data_freshness || 'nominal');
  const dataLatency = esc(payload.dataLatency || payload.dbLatency || 'operational');
  const providerLatency = esc(payload.providerLatency || payload.apiLatency || 'operational');
  const schedulerStatus = esc(payload.schedulerStatus || 'operational');
  const emailDeliveryStats = esc(payload.emailDeliveryStats || payload.email_delivery_stats || 'No delivery anomalies in last 24h');
  const failedJobs = Array.isArray(payload.failedJobs) ? payload.failedJobs : [];
  const apiStatus = esc(payload.apiStatus || 'operational');
  const failedJobRows = failedJobs.length
    ? failedJobs.map((row) => `<li style="margin:0 0 6px 18px;color:${severityColor(row.severity)};">[${esc(row.severity || 'WARNING')}] ${esc(row.name || row.message || 'unknown job')}</li>`).join('')
    : '<li style="margin:0 0 6px 18px;color:#94a3b8;">No failed jobs.</li>';

  const body = `
    <div style="font-size:18px;font-weight:800;color:#f8fafc;margin-bottom:10px;">OpenRange System Monitor</div>
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;">API status: <strong style="color:#e2e8f0;">${apiStatus}</strong> | Data latency: ${dataLatency} | Provider latency: ${providerLatency}</div>
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px;">Data freshness: <strong style="color:#e2e8f0;">${dataFreshness}</strong> | Scheduler status: <strong style="color:#e2e8f0;">${schedulerStatus}</strong> | Email delivery stats: ${emailDeliveryStats}</div>

    <div style="font-size:14px;color:#93c5fd;font-weight:700;margin:12px 0 8px 0;">Engine Health</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0f172a;border:1px solid #1f2937;">
      <tr>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Engine</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Status</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;border-bottom:1px solid #1f2937;">Lag (s)</th>
      </tr>
      ${engineRows}
    </table>

    <div style="margin-top:10px;font-size:14px;color:#93c5fd;font-weight:700;">Failed Jobs</div>
    <ul style="margin:6px 0 0 0;padding:0;">${failedJobRows}</ul>

    <div style="margin-top:10px;font-size:14px;color:#93c5fd;font-weight:700;">Alerts</div>
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
