import { useEffect, useState } from 'react';
import Portal from '../shared/Portal';

export default function EditAlertModal({ alert, onClose, onSave, saving = false }) {
  const [form, setForm] = useState({
    alert_name: '',
    frequency: 60,
    enabled: true,
    message_template: '',
  });

  useEffect(() => {
    if (!alert) return;
    setForm({
      alert_name: alert.alert_name || '',
      frequency: Number(alert.frequency) || 60,
      enabled: Boolean(alert.enabled),
      message_template: alert.message_template || '',
    });
  }, [alert]);

  useEffect(() => {
    if (!alert) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [alert, onClose]);

  if (!alert) return null;

  function handleSubmit(event) {
    event.preventDefault();
    onSave?.({
      ...form,
      frequency: Math.max(30, Number(form.frequency) || 60),
    });
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
        <div className="w-full max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 shadow-[0_20px_35px_rgba(0,0,0,0.35)]" onClick={(event) => event.stopPropagation()}>
          <div className="mb-3">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Edit Alert</h3>
            <p className="text-xs text-[var(--text-muted)]">Query tree remains unchanged.</p>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <label className="block text-xs text-[var(--text-secondary)]">
              Alert Name
              <input
                className="input-field mt-1 w-full"
                value={form.alert_name}
                onChange={(event) => setForm((prev) => ({ ...prev, alert_name: event.target.value }))}
                required
              />
            </label>

            <label className="block text-xs text-[var(--text-secondary)]">
              Frequency (seconds)
              <input
                className="input-field mt-1 w-full"
                type="number"
                min={30}
                value={form.frequency}
                onChange={(event) => setForm((prev) => ({ ...prev, frequency: event.target.value }))}
                required
              />
            </label>

            <label className="block text-xs text-[var(--text-secondary)]">
              Message Template
              <textarea
                className="input-field mt-1 min-h-[86px] w-full"
                value={form.message_template}
                onChange={(event) => setForm((prev) => ({ ...prev, message_template: event.target.value }))}
                placeholder="{symbol} triggered alert"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>Enabled</span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary rounded-lg px-3 py-2 text-sm" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
