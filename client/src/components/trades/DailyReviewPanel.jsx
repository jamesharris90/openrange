import { useState, useEffect } from 'react';
import { authFetch } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const MOOD_LABELS = ['', 'Frustrated', 'Uneasy', 'Neutral', 'Confident', 'Excellent'];

export default function DailyReviewPanel({ date, scope = 'user', onClose }) {
  const { success, error: showError } = useToast();
  const [form, setForm] = useState({ summaryText: '', lessonsText: '', planTomorrow: '', mood: 3, rating: 3 });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!date) return;
    authFetch(`/api/reviews/${date}?scope=${scope}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.review_id) {
          setForm({
            summaryText: data.summary_text || '',
            lessonsText: data.lessons_text || '',
            planTomorrow: data.plan_tomorrow || '',
            mood: data.mood || 3,
            rating: data.rating || 3,
          });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [date, scope]);

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/reviews/${date}?scope=${scope}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to save review');
      success('Review saved');
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="panel review-panel"><p className="muted">Loading review...</p></div>;

  return (
    <div className="panel review-panel">
      <div className="review-header">
        <h3 className="panel-title">Daily Review — {date}</h3>
        {onClose && <button className="btn-secondary btn-sm" onClick={onClose}>Close</button>}
      </div>

      <div className="profile-field">
        <label className="profile-label">Summary</label>
        <textarea className="profile-input review-textarea" value={form.summaryText} onChange={e => update('summaryText', e.target.value)} placeholder="How did the day go?" rows={3} />
      </div>

      <div className="profile-field">
        <label className="profile-label">Lessons Learned</label>
        <textarea className="profile-input review-textarea" value={form.lessonsText} onChange={e => update('lessonsText', e.target.value)} placeholder="What did you learn today?" rows={2} />
      </div>

      <div className="profile-field">
        <label className="profile-label">Plan for Tomorrow</label>
        <textarea className="profile-input review-textarea" value={form.planTomorrow} onChange={e => update('planTomorrow', e.target.value)} placeholder="What setups are you watching?" rows={2} />
      </div>

      <div className="review-scores">
        <div className="profile-field">
          <label className="profile-label">Mood: {MOOD_LABELS[form.mood]}</label>
          <input type="range" min="1" max="5" value={form.mood} onChange={e => update('mood', +e.target.value)} className="review-slider" />
        </div>
        <div className="profile-field">
          <label className="profile-label">Day Rating: {form.rating}/5</label>
          <input type="range" min="1" max="5" value={form.rating} onChange={e => update('rating', +e.target.value)} className="review-slider" />
        </div>
      </div>

      <div className="trade-entry-actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Review'}</button>
      </div>
    </div>
  );
}
