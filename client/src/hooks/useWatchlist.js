import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'userWatchlist';
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readAndPruneStore() {
  const raw = readStore();
  const now = Date.now();
  const pruned = raw.filter(item => {
    if (item.source === 'manual') return true;
    if (!item.addedAt) return true;
    return (now - new Date(item.addedAt).getTime()) < STALE_MS;
  });
  if (pruned.length !== raw.length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  }
  return pruned;
}

export default function useWatchlist() {
  const [items, setItems] = useState(readAndPruneStore);

  // Cross-tab sync via StorageEvent
  useEffect(() => {
    const handler = (e) => {
      if (e.key === STORAGE_KEY) {
        setItems(e.newValue ? JSON.parse(e.newValue) : []);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const save = useCallback((list) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    setItems(list);
  }, []);

  const add = useCallback((symbol, source = 'manual') => {
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) return false;
    const current = readStore();
    if (current.some(i => i.symbol === sym)) return false;
    current.push({ symbol: sym, source, addedAt: new Date().toISOString() });
    save(current);
    return true;
  }, [save]);

  const remove = useCallback((symbol) => {
    const sym = (symbol || '').trim().toUpperCase();
    save(readStore().filter(i => i.symbol !== sym));

    // Bi-directional sync: also remove from emWatchlist (Expected Move page)
    try {
      const emRaw = localStorage.getItem('emWatchlist');
      if (emRaw) {
        const emList = JSON.parse(emRaw);
        if (Array.isArray(emList) && emList.includes(sym)) {
          localStorage.setItem('emWatchlist', JSON.stringify(emList.filter(t => t !== sym)));
        }
      }
    } catch (_) { /* ignore */ }
  }, [save]);

  const has = useCallback((symbol) => {
    const sym = (symbol || '').trim().toUpperCase();
    return items.some(i => i.symbol === sym);
  }, [items]);

  return { items, add, remove, has };
}
