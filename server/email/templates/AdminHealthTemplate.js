'use strict';

const { renderEmailLayout, esc } = require('./EmailLayout');

function scoreColor(score) {
  if (score >= 90) return '#10b981';
  if (score >= 70) return '#f59e0b';
  return '#ef4444';
}

function statusBadge(status) {
  const color = status === 'OPERATIONAL' ? '#10b981' : status === 'DEGRADED' ? '#f59e0b' : '#ef4444';
  return `<span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px;">${esc(status)}</span>`;
}

function metricRow(label, value, note, highlight = false) {
  const valueColor = highlight ? '#f87171' : '#e2e8f0';
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#94a3b8;font-size:12px;">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:${valueColor};font-weight:700;font-size:12px;">${esc(String(value ?? '—'))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#64748b;font-size:11px;">${esc(note || '')}</td>
    </tr>`;
}

function renderAdminHealthTemplate(payload = {}) {
  const score     = Number(payload.score ?? 0);
  const status    = String(payload.status ?? 'UNKNOWN');
  const isCritical = status === 'CRITICAL';
  const sessionLabel = String(payload.session_label || new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

  const evalRate    = payload.evaluation_rate_pct   != null ? `${payload.evaluation_rate_pct}%`   : '—';
  const winRate7d   = payload.win_rate_7d           != null ? `${payload.win_rate_7d}%`           : '—';
  const signals24h  = payload.signals_logged_24h    != null ? String(payload.signals_logged_24h)  : '—';
  const errors24h   = payload.errors_24h            != null ? String(payload.errors_24h)          : '—';
  const stuckCount  = payload.stuck_signals         != null ? String(payload.stuck_signals)       : '—';
  const avgReturn   = payload.avg_return_today      != null ? `${Number(payload.avg_return_today) >= 0 ? '+' : ''}${Number(payload.avg_return_today).toFixed(2)}%` : '—';

  const pipelineItems = Array.isArray(payload.pipeline) ? payload.pipeline : [];
  const pipelineRows = pipelineItems.map(t => {
    const ageColor = t.status === 'green' ? '#10b981' : t.status === 'amber' ? '#f59e0b' : '#ef4444';
    return `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #1f2937;font-family:monospace;color:#cbd5e1;font-size:11px;">${esc(t.table)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #1f2937;color:#94a3b8;font-size:11px;">${t.row_count ? Number(t.row_count).toLocaleString() : '—'} rows</td>
        <td style="padding:6px 12px;border-bottom:1px solid #1f2937;color:${ageColor};font-size:11px;">${esc(t.age_label || '—')}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="3" style="padding:8px;color:#64748b;">Pipeline data unavailable</td></tr>';

  const appBase = String(process.env.APP_BASE_URL || 'https://openrangetrading.co.uk').replace(/\/$/, '');

  const body = `
    <!-- Score hero -->
    <div style="text-align:center;padding:24px 16px;background:${isCritical ? '#1a0a0a' : '#0a1a12'};border-bottom:1px solid #1f2937;">
      <div style="font-size:56px;font-weight:900;color:${scoreColor(score)};line-height:1;">${score}</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px;">System Score</div>
      <div style="margin-top:8px;">${statusBadge(status)}</div>
      <div style="font-size:11px;color:#475569;margin-top:8px;">${sessionLabel}</div>
    </div>

    <!-- Key metrics -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;padding:12px 16px 6px;">Key Metrics</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${metricRow('Evaluation Rate',  evalRate,   'signals evaluated vs eligible',  payload.evaluation_rate_pct < 95)}
      ${metricRow('Win Rate (7d)',     winRate7d,  'signal_performance_summary')}
      ${metricRow('Signals (24h)',     signals24h, 'logged to signal_log')}
      ${metricRow('Avg Return Today',  avgReturn,  'per evaluated signal')}
      ${metricRow('Errors (24h)',      errors24h,  'outcome=ERROR',                  Number(payload.errors_24h) > 0)}
      ${metricRow('Stuck Signals',     stuckCount, 'unevaluated >1h',                Number(payload.stuck_signals) > 0)}
    </table>

    <!-- Data freshness -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;padding:12px 16px 6px;margin-top:8px;">Data Freshness</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr style="background:#0f172a;">
        <th style="padding:6px 12px;text-align:left;color:#64748b;font-size:10px;border-bottom:1px solid #1f2937;">Table</th>
        <th style="padding:6px 12px;text-align:left;color:#64748b;font-size:10px;border-bottom:1px solid #1f2937;">Rows</th>
        <th style="padding:6px 12px;text-align:left;color:#64748b;font-size:10px;border-bottom:1px solid #1f2937;">Age</th>
      </tr>
      ${pipelineRows}
    </table>

    ${isCritical ? `
    <!-- Critical alert banner -->
    <div style="margin:16px;padding:12px;background:#1a0808;border:1px solid #991b1b;border-radius:6px;">
      <div style="color:#f87171;font-weight:700;font-size:13px;">⚠ Action Required</div>
      <div style="color:#fca5a5;font-size:12px;margin-top:6px;line-height:1.5;">
        System score is below 70 — immediate attention needed.
        Check the admin panel for details.
      </div>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;padding:16px;">
      <a href="${appBase}/admin" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:13px;">
        Open Admin Panel
      </a>
    </div>
  `;

  return renderEmailLayout({
    title:    isCritical ? '⚠️ OpenRange System Alert' : 'OpenRange System Status',
    preheader: `System score: ${score}/100 · Status: ${status}`,
    bodyHtml:  body,
  });
}

module.exports = { renderAdminHealthTemplate };
