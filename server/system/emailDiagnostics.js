const status = {
  last_email_sent: null,
  email_queue_length: 0,
  smtp_status: 'unknown',
};

function updateEmailDiagnostics(next = {}) {
  Object.assign(status, next);
  global.emailStatus = status.smtp_status;
}

function getEmailDiagnostics(_req, res) {
  res.json({ ok: true, data: status, error: null });
}

module.exports = {
  updateEmailDiagnostics,
  getEmailDiagnostics,
};
