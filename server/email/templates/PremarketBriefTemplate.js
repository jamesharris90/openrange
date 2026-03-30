'use strict';

const { renderEmailLayout, esc } = require('./EmailLayout');

function ratingColor(rating) {
  if (!rating) return '#94a3b8';
  const r = String(rating).toUpperCase();
  if (r === 'ELITE')  return '#10b981';
  if (r === 'GOOD')   return '#3b82f6';
  if (r === 'WATCH')  return '#f59e0b';
  return '#94a3b8';
}

function gapColor(gap) {
  const g = Number(gap || 0);
  if (g >=  3) return '#10b981';
  if (g >=  1) return '#3b82f6';
  if (g <= -1) return '#ef4444';
  return '#94a3b8';
}

function renderPremarketBriefTemplate(payload = {}) {
  const movers   = Array.isArray(payload.movers)   ? payload.movers.slice(0, 10)  : [];
  const setups   = Array.isArray(payload.setups)   ? payload.setups.slice(0, 5)   : [];
  const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist.slice(0, 8) : [];
  const warnings = Array.isArray(payload.warnings)  ? payload.warnings            : [];
  const appBase  = String(process.env.APP_BASE_URL || 'https://openrangetrading.co.uk').replace(/\/$/, '');

  const moverRows = movers.map(r => {
    const gap  = Number(r.premarket_gap || r.gap_percent || 0);
    const rvol = Number(r.premarket_volume_ratio || r.relative_volume || 0);
    const link = `${appBase}/research/${encodeURIComponent(String(r.symbol || '').toUpperCase())}`;
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;">
          <a href="${link}" style="color:#38bdf8;text-decoration:none;font-weight:700;">${esc(r.symbol)}</a>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:${gapColor(gap)};">
          ${gap > 0 ? '+' : ''}${gap.toFixed(2)}%
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:#cbd5e1;">
          ${rvol > 0 ? rvol.toFixed(1) + 'x' : '—'}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #1f2937;color:${ratingColor(r.execution_rating)};">
          ${esc(r.execution_rating || 'WATCH')}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="4" style="padding:10px;color:#94a3b8;">No premarket movers available</td></tr>';

  const setupRows = setups.map(r => {
    const link = `${appBase}/research/${encodeURIComponent(String(r.symbol || '').toUpperCase())}`;
    const entry  = r.entry_price  ? `$${Number(r.entry_price).toFixed(2)}`  : '—';
    const stop   = r.stop_price   ? `$${Number(r.stop_price).toFixed(2)}`   : '—';
    const target = r.target_price ? `$${Number(r.target_price).toFixed(2)}` : '—';
    const rr     = r.risk_reward_ratio ? Number(r.risk_reward_ratio).toFixed(1) + 'R' : '—';
    return `
      <tr style="background:#0f172a;">
        <td style="padding:12px;border-bottom:1px solid #1f2937;border-left:3px solid ${ratingColor(r.execution_rating)};">
          <a href="${link}" style="color:#38bdf8;text-decoration:none;font-weight:700;font-size:15px;">${esc(r.symbol)}</a>
          <div style="margin-top:4px;color:#94a3b8;font-size:11px;">${esc(r.execution_type || r.premarket_signal_type || 'SETUP')}</div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #1f2937;">
          <div style="color:#e2e8f0;font-size:12px;">Entry: <strong>${entry}</strong></div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px;">Stop: ${stop} | Target: ${target}</div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #1f2937;text-align:center;">
          <span style="color:${ratingColor(r.execution_rating)};font-weight:700;font-size:13px;">${esc(r.execution_rating || 'WATCH')}</span>
          <div style="color:#64748b;font-size:11px;margin-top:2px;">${rr}</div>
        </td>
      </tr>
      ${r.execution_notes ? `<tr><td colspan="3" style="padding:6px 12px 10px;border-bottom:1px solid #1e293b;background:#0b1220;"><div style="color:#93c5fd;font-size:11px;font-style:italic;">${esc(r.execution_notes)}</div></td></tr>` : ''}`;
  }).join('') || '<tr><td colspan="3" style="padding:10px;color:#94a3b8;">No high-conviction setups today</td></tr>';

  const watchRows = watchlist.map(r => {
    const link = `${appBase}/research/${encodeURIComponent(String(r.symbol || '').toUpperCase())}`;
    const pmHigh = r.pm_high ? `$${Number(r.pm_high).toFixed(2)}` : '—';
    const pmLow  = r.pm_low  ? `$${Number(r.pm_low).toFixed(2)}`  : '—';
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #1f2937;">
          <a href="${link}" style="color:#38bdf8;text-decoration:none;">${esc(r.symbol)}</a>
        </td>
        <td style="padding:8px;border-bottom:1px solid #1f2937;color:#94a3b8;font-size:11px;">
          Watch for breakout above ${pmHigh} / Avoid if fails below ${pmLow}
        </td>
      </tr>`;
  }).join('') || '<tr><td colspan="2" style="padding:10px;color:#94a3b8;">Watchlist populates 30 min before open</td></tr>';

  const warningItems = warnings.map(w =>
    `<li style="margin:0 0 6px 18px;color:#fbbf24;">${esc(w)}</li>`
  ).join('') || '<li style="margin:0 0 6px 18px;color:#64748b;">No risk warnings for today\'s session</li>';

  const sessionTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long', month: 'long', day: 'numeric' });

  const body = `
    <div style="font-size:18px;font-weight:800;color:#f8fafc;margin-bottom:4px;">Premarket Briefing</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:18px;">${sessionTime} · US Open 13:30 UK</div>

    <!-- Section 1: Premarket Movers -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin:0 0 8px;">Top Premarket Movers</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0b1220;border:1px solid #1e293b;">
      <tr style="background:#0f172a;">
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Symbol</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Gap %</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">RVOL</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Rating</th>
      </tr>
      ${moverRows}
    </table>

    <!-- Section 2: High Conviction Setups -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin:18px 0 8px;">High Conviction Setups</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0b1220;border:1px solid #1e293b;">
      <tr style="background:#0f172a;">
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Symbol</th>
        <th style="padding:8px;text-align:left;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Levels</th>
        <th style="padding:8px;text-align:center;color:#93c5fd;font-size:11px;border-bottom:1px solid #1f2937;">Rating</th>
      </tr>
      ${setupRows}
    </table>

    <!-- Section 3: Execution Watchlist -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin:18px 0 8px;">Execution Watchlist</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0b1220;border:1px solid #1e293b;">
      ${watchRows}
    </table>

    <!-- Section 4: Risk Warnings -->
    <div style="font-size:12px;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin:18px 0 8px;">⚠ Risk Warnings</div>
    <ul style="margin:0;padding:0;background:#0b1220;border:1px solid #1e293b;border-radius:4px;padding:12px 8px;">
      ${warningItems}
    </ul>

    <div style="margin-top:18px;padding:12px;background:#0f172a;border-left:3px solid #3b82f6;border-radius:0 4px 4px 0;">
      <div style="color:#93c5fd;font-size:12px;font-weight:700;">Reminder</div>
      <div style="color:#cbd5e1;font-size:12px;margin-top:4px;line-height:1.5;">
        US markets open at 13:30 UK. Wait for confirmed breaks above PM high before entry.
        Never chase extended pre-open spikes.
      </div>
    </div>
  `;

  return renderEmailLayout({
    title:    'Premarket Briefing — OpenRange',
    preheader: `${movers.length} movers, ${setups.length} high-conviction setups for today's open`,
    bodyHtml:  body,
  });
}

module.exports = { renderPremarketBriefTemplate };
