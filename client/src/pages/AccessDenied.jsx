import { Link } from 'react-router-dom';

export default function AccessDenied() {
  return (
    <div className="mx-auto mt-10 max-w-2xl rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Access denied</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        This feature is not included in your plan.
      </p>
      <div className="mt-4 flex gap-2">
        <Link to="/dashboard" className="rounded-md bg-[var(--accent-blue)] px-4 py-2 text-sm text-white">
          Back to Dashboard
        </Link>
        <Link to="/profile" className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)]">
          View Profile
        </Link>
      </div>
    </div>
  );
}
