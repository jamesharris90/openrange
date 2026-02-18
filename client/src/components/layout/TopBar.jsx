import { useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const PAGE_TITLES = {
  '/watchlist': 'Watchlist',
  '/gappers': 'Gappers',
  '/earnings': 'Earnings Calendar',
  '/screeners': 'Screeners',
  '/premarket': 'Pre-Market Scanner',
  '/open-market': 'Open Market',
  '/postmarket': 'Post-Market',
  '/market-overview': 'Market Overview',
  '/market-hours': 'Market Hours',
  '/news-scanner': 'News Scanner',
  '/advanced-screener': 'Advanced Screener',
  '/research': 'Research',
  '/expected-move': 'Expected Move',
  '/intelligence-engine': 'Intelligence Engine',
  '/ai-quant': 'Intelligence Engine',
};

const MARKETS = [
  {
    key: 'LDN',
    label: 'LDN',
    flagClass: 'market-pill__flag--uk',
    timeZone: 'Europe/London',
    hours: { openH: 8, openM: 0, closeH: 16, closeM: 30 },
  },
  {
    key: 'NYC',
    label: 'NYC',
    flagClass: 'market-pill__flag--us',
    timeZone: 'America/New_York',
    hours: { openH: 9, openM: 30, closeH: 16, closeM: 0 },
  },
];

function formatDiff(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeState(timeZone, hours) {
  const now = new Date();
  const zoned = new Date(now.toLocaleString('en-US', { timeZone }));

  const hh = String(zoned.getHours()).padStart(2, '0');
  const mm = String(zoned.getMinutes()).padStart(2, '0');

  const open = new Date(zoned);
  open.setHours(hours.openH, hours.openM, 0, 0);

  const close = new Date(zoned);
  close.setHours(hours.closeH, hours.closeM, 0, 0);

  const day = zoned.getDay();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    const nextOpen = new Date(open);
    nextOpen.setDate(open.getDate() + ((1 + 7 - day) % 7 || 1));
    return { time: `${hh}:${mm}`, status: `Closed · opens in ${formatDiff(nextOpen - zoned)}`, isOpen: false };
  }

  if (zoned < open) {
    return { time: `${hh}:${mm}`, status: `Opens in ${formatDiff(open - zoned)}`, isOpen: false };
  }

  if (zoned >= open && zoned < close) {
    return { time: `${hh}:${mm}`, status: `Open · closes in ${formatDiff(close - zoned)}`, isOpen: true };
  }

  const nextOpen = new Date(open);
  nextOpen.setDate(open.getDate() + 1);
  while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  }

  return { time: `${hh}:${mm}`, status: `Closed · opens in ${formatDiff(nextOpen - zoned)}`, isOpen: false };
}

export default function TopBar() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'OpenRange Trader';

  const [markets, setMarkets] = useState(() =>
    MARKETS.map(m => ({ ...m, time: '--:--', status: 'Loading…', isOpen: false }))
  );

  useEffect(() => {
    const update = () => {
      setMarkets(MARKETS.map(m => ({ ...m, ...computeState(m.timeZone, m.hours) })));
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="top-bar">
      <h1 className="page-title">{title}</h1>
      <div className="market-pill-group">
        {markets.map(({ key, label, flagClass, time, status, isOpen }) => (
          <div className="market-pill" key={key}>
            <span className={`market-pill__flag ${flagClass}`} aria-hidden="true" />
            <span className="market-pill__label">{label}</span>
            <span className="market-pill__time">{time}</span>
            <span className="market-pill__status" style={isOpen ? { color: 'var(--accent-green)' } : undefined}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
