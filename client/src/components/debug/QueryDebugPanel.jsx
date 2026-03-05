import { useState } from 'react';

function isDevEnvironment() {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) return true;
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') return true;
  return false;
}

export default function QueryDebugPanel({ queryTree, backendQuery }) {
  const [collapsed, setCollapsed] = useState(true);

  if (!isDevEnvironment()) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-24px)]">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_12px_26px_rgba(0,0,0,0.25)]">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          onClick={() => setCollapsed((current) => !current)}
        >
          <span>Query Debug Panel</span>
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>

        {!collapsed && (
          <div className="space-y-2 border-t border-[var(--border-color)] p-3">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Query Tree JSON</div>
              <pre className="max-h-44 overflow-auto rounded bg-[var(--bg-card-hover)] p-2 text-[11px] text-[var(--text-secondary)]">
                {JSON.stringify(queryTree, null, 2)}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Backend SQL Mapping</div>
              <pre className="max-h-44 overflow-auto rounded bg-[var(--bg-card-hover)] p-2 text-[11px] text-[var(--text-secondary)]">
                {JSON.stringify(backendQuery, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
