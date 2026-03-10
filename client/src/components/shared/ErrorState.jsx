export default function ErrorState({
  title = 'Something went wrong',
  message = 'The requested data is unavailable right now.',
  onRetry,
}) {
  return (
    <div className="rounded border border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.08)] p-3 text-sm">
      <div className="font-semibold text-[var(--accent-red)]">{title}</div>
      <div className="mt-1 text-[var(--text-secondary)]">{message}</div>
      {typeof onRetry === 'function' && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-[var(--border-color)] px-2 py-1 text-xs"
        >
          Retry
        </button>
      )}
    </div>
  );
}
