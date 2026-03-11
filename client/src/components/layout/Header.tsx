import { Menu, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

type Market = {
  key: 'LDN' | 'NYC';
  flag: string;
  timeZone: string;
  hours: { openH: number; openM: number; closeH: number; closeM: number };
};

type MarketState = {
  key: 'LDN' | 'NYC';
  flag: string;
  time: string;
  status: string;
  isOpen: boolean;
};

const MARKETS: Market[] = [
  {
    key: 'LDN',
    flag: '🇬🇧',
    timeZone: 'Europe/London',
    hours: { openH: 8, openM: 0, closeH: 16, closeM: 30 },
  },
  {
    key: 'NYC',
    flag: '🇺🇸',
    timeZone: 'America/New_York',
    hours: { openH: 9, openM: 30, closeH: 16, closeM: 0 },
  },
];

function formatDiff(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function computeState(timeZone: string, hours: Market['hours']) {
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
    return { time: `${hh}:${mm}`, status: `Closed · opens in ${formatDiff(nextOpen.getTime() - zoned.getTime())}`, isOpen: false };
  }

  if (zoned < open) {
    return { time: `${hh}:${mm}`, status: `Opens in ${formatDiff(open.getTime() - zoned.getTime())}`, isOpen: false };
  }

  if (zoned >= open && zoned < close) {
    return { time: `${hh}:${mm}`, status: `Open · closes in ${formatDiff(close.getTime() - zoned.getTime())}`, isOpen: true };
  }

  const nextOpen = new Date(open);
  nextOpen.setDate(open.getDate() + 1);
  while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  }

  return { time: `${hh}:${mm}`, status: `Closed · opens in ${formatDiff(nextOpen.getTime() - zoned.getTime())}`, isOpen: false };
}

export default function Header() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleMobileSidebar = useAppStore((state) => state.toggleMobileSidebar);

  const [markets, setMarkets] = useState<MarketState[]>(
    MARKETS?.map((market) => ({
      key: market.key,
      flag: market.flag,
      time: '--:--',
      status: 'Loading…',
      isOpen: false,
    }))
  );

  useEffect(() => {
    const update = () => {
      setMarkets(
        MARKETS?.map((market) => ({
          key: market.key,
          flag: market.flag,
          ...computeState(market.timeZone, market.hours),
        }))
      );
    };

    update();
    const intervalId = setInterval(update, 30000);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-14 w-full border-b border-[var(--border-color)] bg-[color:var(--bg-secondary)]/90 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full items-center justify-between gap-3 px-3 sm:px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] md:hidden"
            onClick={toggleMobileSidebar}
            aria-label="Open sidebar"
          >
            <Menu size={18} />
          </button>

          <NavLink to="/dashboard" className="flex min-w-0 items-center gap-2 text-inherit no-underline">
            <img src="/OpenRange_Logo_White.png" alt="OpenRange Trading" className="h-6 w-6 rounded-sm object-contain sm:h-8 sm:w-8" />
            <div className="whitespace-nowrap text-sm sm:text-base">
              <span className="font-light">OpenRange</span>{' '}
              <span className="font-bold">Trading</span>
            </div>
          </NavLink>
        </div>

        <nav className="hidden min-w-0 items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] lg:flex">
          <NavLink to="/open-market-radar" className="rounded px-2 py-1 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]">Radar</NavLink>
          <NavLink to="/screener" className="rounded px-2 py-1 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]">Scanner</NavLink>
          <NavLink to="/watchlist" className="rounded px-2 py-1 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]">Watchlist</NavLink>
          <NavLink to="/news-feed" className="rounded px-2 py-1 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]">News</NavLink>
          <NavLink to="/cockpit" className="rounded px-2 py-1 hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]">Cockpit</NavLink>
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span className="hidden text-xs font-semibold sm:inline">Theme</span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap">
            {markets?.map((market) => (
              <div key={market.key} className="flex items-center gap-1.5 text-xs leading-none">
                <span aria-hidden="true">{market.flag}</span>
                <span className="hidden font-semibold text-[var(--text-secondary)] md:inline">{market.key}</span>
                <span className="font-semibold text-[var(--text-primary)]">{market.time}</span>
                <span className={`hidden lg:inline ${market.isOpen ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>
                  {market.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
