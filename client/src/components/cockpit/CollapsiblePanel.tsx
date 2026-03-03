import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type CollapsiblePanelProps = {
  title: string;
  storageKey?: string;
  children: ReactNode;
};

function normalizeStorageKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function CollapsiblePanel({ title, storageKey, children }: CollapsiblePanelProps) {
  const key = useMemo(() => storageKey || `panel-${normalizeStorageKey(title)}`, [storageKey, title]);
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(key) !== 'closed';
  });

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, next ? 'open' : 'closed');
      }
      return next;
    });
  };

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-xs uppercase tracking-wider text-gray-400">{title}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-[600px] opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'}`}>
        <div className="text-sm text-gray-200">{children}</div>
      </div>
    </div>
  );
}