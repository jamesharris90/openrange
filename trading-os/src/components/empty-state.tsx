type EmptyStateProps = {
  message: string;
};

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-6 text-center shadow-lg">
      <div className="text-sm font-medium text-slate-200">{message}</div>
    </div>
  );
}
