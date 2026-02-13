import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'userWatchlist';
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function sanitizeList(list) {
  if (!Array.isArray(list)) return [];
  const now = Date.now();
  return list.filter(item => {
    if (!item || !item.symbol) return false;
    if (item.source === 'manual') return true;
    if (!item.addedAt) return true;
    return (now - new Date(item.addedAt).getTime()) < STALE_MS;
  });
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const pruned = sanitizeList(parsed);
    if (pruned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return [];
  }
}

export default function useWatchlist() {
  const [items, setItems] = useState(loadInitial);

  // Cross-tab sync via StorageEvent
  useEffect(() => {
    const handler = (e) => {
      if (e.key === STORAGE_KEY) {
          try {
            const parsed = e.newValue ? JSON.parse(e.newValue) : [];
            setItems(sanitizeList(parsed));
          } catch {
            setItems([]);
          }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const persist = useCallback((nextList) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList));
    setItems(nextList);
  }, []);

  const add = useCallback((symbol, source = 'manual') => {
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) return false;
    let added = false;
    setItems(prev => {
      if (prev.some(i => i.symbol === sym)) return prev;
      const next = [...prev, { symbol: sym, source, addedAt: new Date().toISOString() }];
      persist(next);
      added = true;
      return next;
    });
    return added;
  }, [persist]);

  const remove = useCallback((symbol) => {
    const sym = (symbol || '').trim().toUpperCase();
    setItems(prev => {
      const next = prev.filter(i => i.symbol !== sym);
      persist(next);
      return next;
    });

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
  }, [persist]);

  const has = useCallback((symbol) => {
    const sym = (symbol || '').trim().toUpperCase();
    return items.some(i => i.symbol === sym);
  }, [items]);

  return { items, add, remove, has };
}
