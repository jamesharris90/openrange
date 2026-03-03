import { useState, useRef, useEffect } from 'react';
import { Settings, ChevronUp, ChevronDown, Eye, EyeOff, Plus } from 'lucide-react';

const STORAGE_KEY = 'aiq-strategy-prefs';

const SYSTEM_STRATEGIES = ['orb', 'earnings', 'continuation'];

export function loadStrategyPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure all system strategies are present
      for (const s of SYSTEM_STRATEGIES) {
        if (!parsed.order.includes(s)) parsed.order.push(s);
        if (parsed.active[s] === undefined) parsed.active[s] = true;
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return {
    order: [...SYSTEM_STRATEGIES],
    active: Object.fromEntries(SYSTEM_STRATEGIES.map(s => [s, true])),
  };
}

function saveStrategyPrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

export default function StrategyManager({ prefs, setPrefs, onAddCustom }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = (id) => {
    const activeCount = Object.values(prefs.active).filter(Boolean).length;
    if (prefs.active[id] && activeCount <= 1) return; // Must keep at least 1 active
    const next = { ...prefs, active: { ...prefs.active, [id]: !prefs.active[id] } };
    setPrefs(next);
    saveStrategyPrefs(next);
  };

  const moveUp = (id) => {
    const idx = prefs.order.indexOf(id);
    if (idx <= 0) return;
    const order = [...prefs.order];
    [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
    const next = { ...prefs, order };
    setPrefs(next);
    saveStrategyPrefs(next);
  };

  const moveDown = (id) => {
    const idx = prefs.order.indexOf(id);
    if (idx < 0 || idx >= prefs.order.length - 1) return;
    const order = [...prefs.order];
    [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
    const next = { ...prefs, order };
    setPrefs(next);
    saveStrategyPrefs(next);
  };

  const LABELS = {
    orb: 'ORB Intraday',
    earnings: 'Earnings Momentum',
    continuation: 'Continuation',
  };

  return (
    <div className="aiq-strat-mgr" ref={ref}>
      <button className="aiq-icon-btn" onClick={() => setOpen(!open)} title="Manage strategies">
        <Settings size={14} />
      </button>
      {open && (
        <div className="aiq-strat-mgr__dropdown">
          <div className="aiq-strat-mgr__title">Strategies</div>
          {prefs.order.map((id, idx) => {
            const isCustom = !SYSTEM_STRATEGIES.includes(id);
            const label = LABELS[id] || id;
            return (
              <div key={id} className="aiq-strat-mgr__item">
                <button className="aiq-strat-mgr__vis" onClick={() => toggle(id)}
                  title={prefs.active[id] ? 'Hide strategy' : 'Show strategy'}>
                  {prefs.active[id] ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <span className={`aiq-strat-mgr__label ${!prefs.active[id] ? 'disabled' : ''}`}>
                  {label}{isCustom && ' *'}
                </span>
                <div className="aiq-strat-mgr__arrows">
                  <button onClick={() => moveUp(id)} disabled={idx === 0}><ChevronUp size={12} /></button>
                  <button onClick={() => moveDown(id)} disabled={idx === prefs.order.length - 1}><ChevronDown size={12} /></button>
                </div>
              </div>
            );
          })}
          {onAddCustom && (
            <button className="aiq-strat-mgr__add" onClick={() => { onAddCustom(); setOpen(false); }}>
              <Plus size={12} /> New Custom Strategy
            </button>
          )}
        </div>
      )}
    </div>
  );
}
