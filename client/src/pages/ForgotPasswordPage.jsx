import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!identifier.trim()) {
      setError('Please enter your username or email');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/users/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.ok) {
        setSuccess(data.message || 'If an account exists with that username/email, a reset link has been sent.');
      } else {
        setError(data.error || 'Request failed. Please try again.');
      }
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>OpenRange</h1>
          <p>RESET PASSWORD</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="identifier">Username or Email</label>
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Enter your username or email"
              autoFocus
            />
          </div>

          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting && <span className="auth-spinner-sm" />}
            Send Reset Link
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
