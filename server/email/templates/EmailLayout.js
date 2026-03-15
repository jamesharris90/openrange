function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailLayout({ title, preheader, bodyHtml, footerNote }) {
  const safeTitle = esc(title || 'OpenRange Intelligence');
  const safePreheader = esc(preheader || 'OpenRange institutional intelligence update');
  const safeFooter = esc(footerNote || 'You are receiving this because your OpenRange email preferences are enabled.');

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0;padding:0;background:#020617;font-family:Arial,sans-serif;color:#e2e8f0;">
    <tr>
      <td align="center" style="padding:18px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:700px;background:#0b1220;border:1px solid #1e293b;border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:18px 20px;background:#0f172a;border-bottom:1px solid #1f2937;">
              <div style="font-size:22px;font-weight:800;color:#38bdf8;">OpenRange</div>
              <div style="font-size:16px;font-weight:700;color:#e2e8f0;margin-top:4px;">${safeTitle}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px;">${bodyHtml || ''}</td>
          </tr>
          <tr>
            <td style="padding:14px 20px;background:#0f172a;border-top:1px solid #1f2937;">
              <div style="font-size:12px;color:#94a3b8;line-height:1.5;">${safeFooter}</div>
              <div style="margin-top:8px;font-size:12px;">
                <a href="https://openrangetrading.co.uk/radar" style="color:#93c5fd;text-decoration:none;margin-right:12px;">Radar</a>
                <a href="https://openrangetrading.co.uk/opportunities" style="color:#93c5fd;text-decoration:none;margin-right:12px;">Opportunities</a>
                <a href="https://openrangetrading.co.uk/profile" style="color:#64748b;text-decoration:none;">Manage Preferences</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

module.exports = {
  renderEmailLayout,
  esc,
};
