import type { CatalystEvent } from './calendar-types'

// Deprecated for the live calendar path. Retained only as a UI fallback when the backend is unavailable.

// Generate dates relative to today
const today = new Date()
const getDate = (daysFromNow: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() + daysFromNow)
  return d
}

export const mockEvents: CatalystEvent[] = [
  // Today's events
  {
    id: '1',
    symbol: 'SLQT',
    title: 'Q1 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(0),
    time: 'BMO',
    impliedMove: 42.5,
    avgHistoricalMove: 22.5,
    isWatchlist: true,
  },
  {
    id: '2',
    symbol: 'FWRG',
    title: 'Q1 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(0),
    time: 'BMO',
    impliedMove: 34.0,
    avgHistoricalMove: 28.2,
  },
  {
    id: '3',
    symbol: 'AMD',
    title: 'Q1 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(0),
    time: 'AMC',
    impliedMove: 9.6,
    avgHistoricalMove: 6.5,
    smartMoneyConcentration: 4,
    isWatchlist: true,
  },
  {
    id: '4',
    symbol: 'XRAY',
    title: 'Q1 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(0),
    time: 'AMC',
    impliedMove: 41.9,
    avgHistoricalMove: 15.2,
    description: 'Outlier implied move vs historical',
  },
  {
    id: '5',
    symbol: 'SPY',
    title: 'FOMC Minutes Release',
    category: 'FOMC',
    tier: 2,
    date: getDate(0),
    time: '19:00',
    description: 'Federal Reserve meeting minutes',
  },

  // Tomorrow
  {
    id: '6',
    symbol: 'TSLA',
    title: 'Morgan Stanley Analyst Day',
    category: 'ANALYST_UPGRADE',
    tier: 3,
    date: getDate(1),
    isWatchlist: true,
  },
  {
    id: '7',
    symbol: 'SPY',
    title: 'Non-Farm Payrolls',
    category: 'NFP',
    tier: 2,
    date: getDate(1),
    time: '13:30',
  },

  // Day 2
  {
    id: '8',
    symbol: 'KBR',
    title: 'PDUFA Decision',
    category: 'PDUFA',
    tier: 1,
    date: getDate(2),
    description: 'FDA approval decision for lead drug candidate',
    isWatchlist: true,
  },
  {
    id: '9',
    symbol: 'SPY',
    title: 'CPI Data Release',
    category: 'CPI',
    tier: 2,
    date: getDate(2),
    time: '13:30',
  },

  // Day 3
  {
    id: '10',
    symbol: 'NVDA',
    title: 'AI Conference Presentation',
    category: 'CONFERENCE',
    tier: 3,
    date: getDate(3),
    isWatchlist: true,
  },
  {
    id: '11',
    symbol: 'SPY',
    title: 'PPI Data Release',
    category: 'PPI',
    tier: 2,
    date: getDate(3),
    time: '13:30',
  },

  // Day 4
  {
    id: '12',
    symbol: 'RIGL',
    title: 'FDA Advisory Committee Meeting',
    category: 'FDA_APPROVAL',
    tier: 1,
    date: getDate(4),
    description: 'AdCom review for new drug application',
    smartMoneyConcentration: 3,
  },
  {
    id: '13',
    symbol: 'AAPL',
    title: 'Q2 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(4),
    time: 'AMC',
    impliedMove: 4.2,
    avgHistoricalMove: 3.8,
    isWatchlist: true,
  },

  // Day 5
  {
    id: '14',
    symbol: 'MRNA',
    title: 'Phase 3 Trial Results',
    category: 'TRIAL_SUCCESS',
    tier: 1,
    date: getDate(5),
    description: 'Pivotal trial readout for cancer vaccine',
  },

  // Day 6
  {
    id: '15',
    symbol: 'META',
    title: 'Q2 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(6),
    time: 'AMC',
    impliedMove: 8.5,
    avgHistoricalMove: 7.2,
    isWatchlist: true,
  },
  {
    id: '16',
    symbol: 'GOOGL',
    title: 'Q2 Earnings Report',
    category: 'EARNINGS',
    tier: 2,
    date: getDate(6),
    time: 'AMC',
    impliedMove: 6.8,
    avgHistoricalMove: 5.5,
  },

  // Week 2
  {
    id: '17',
    symbol: 'BIIB',
    title: 'PDUFA Decision',
    category: 'PDUFA',
    tier: 1,
    date: getDate(8),
    description: 'FDA decision on Alzheimer drug',
  },
  {
    id: '18',
    symbol: 'MSFT',
    title: 'Azure AI Conference',
    category: 'CONFERENCE',
    tier: 3,
    date: getDate(9),
    isWatchlist: true,
  },
  {
    id: '19',
    symbol: 'SPY',
    title: 'FOMC Rate Decision',
    category: 'FOMC',
    tier: 2,
    date: getDate(10),
    time: '19:00',
    description: 'Federal Reserve interest rate announcement',
  },
  {
    id: '20',
    symbol: 'LMT',
    title: 'DoD Contract Announcement',
    category: 'CONTRACT_AWARD',
    tier: 1,
    date: getDate(12),
    description: '$2.4B defense contract award expected',
    smartMoneyConcentration: 5,
  },

  // Week 3
  {
    id: '21',
    symbol: 'COIN',
    title: 'IPO Lockup Expiry',
    category: 'IPO_LOCKUP',
    tier: 3,
    date: getDate(15),
    description: '45M shares unlocking',
  },
  {
    id: '22',
    symbol: 'ABBV',
    title: 'FDA Approval Expected',
    category: 'FDA_APPROVAL',
    tier: 1,
    date: getDate(18),
    description: 'New indication approval',
  },
  {
    id: '23',
    symbol: 'GE',
    title: 'Aerospace Spinoff',
    category: 'SPINOFF',
    tier: 3,
    date: getDate(20),
    description: 'GE Aerospace becomes independent',
  },
  {
    id: '24',
    symbol: 'VMW',
    title: 'Broadcom M&A Close',
    category: 'M_AND_A',
    tier: 3,
    date: getDate(22),
    description: 'Acquisition expected to close',
  },

  // Week 4
  {
    id: '25',
    symbol: 'SGEN',
    title: 'Regulatory Clearance',
    category: 'REGULATORY_CLEARANCE',
    tier: 1,
    date: getDate(25),
    description: 'EU approval for cancer treatment',
  },
  {
    id: '26',
    symbol: 'PLTR',
    title: 'Army Contract Decision',
    category: 'CONTRACT_AWARD',
    tier: 1,
    date: getDate(28),
    description: 'Multi-year defense analytics contract',
    smartMoneyConcentration: 4,
  },
]

export const watchlistSymbols = ['AMD', 'NVDA', 'TSLA', 'AAPL', 'META', 'MSFT', 'KBR', 'SLQT']
