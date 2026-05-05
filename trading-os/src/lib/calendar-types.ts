export type EventTier = 1 | 2 | 3 | 4

export type EventCategory =
  | 'FDA_APPROVAL'
  | 'PDUFA'
  | 'TRIAL_SUCCESS'
  | 'CONTRACT_AWARD'
  | 'REGULATORY_CLEARANCE'
  | 'GUIDANCE_RAISE'
  | 'EARNINGS'
  | 'FOMC'
  | 'CPI'
  | 'NFP'
  | 'PPI'
  | 'ANALYST_UPGRADE'
  | 'CONFERENCE'
  | 'PARTNERSHIP'
  | 'INSIDER_BUYING'
  | 'IPO_LOCKUP'
  | 'SPINOFF'
  | 'M_AND_A'
  | 'GENERIC'

export interface CatalystEvent {
  id: string
  symbol: string
  title: string
  category: EventCategory
  tier: EventTier
  date: Date
  time?: string // e.g., "BMO", "AMC", "14:30"
  impliedMove?: number
  avgHistoricalMove?: number
  smartMoneyConcentration?: number
  description?: string
  isWatchlist?: boolean
}

export interface DayEvents {
  date: Date
  events: CatalystEvent[]
  heatIntensity: number // 0-1 scale based on tier-weighted event count
}

export const TIER_CONFIG = {
  1: {
    label: 'Tier 1 Binary',
    color: 'tier1-binary',
    weight: 2.0,
    description: 'High-conviction binary events',
  },
  2: {
    label: 'Tier 1 Quantified',
    color: 'tier1-quantified',
    weight: 1.75,
    description: 'Directional with data',
  },
  3: {
    label: 'Tier 2',
    color: 'tier2',
    weight: 1.5,
    description: 'Directional with conviction',
  },
  4: {
    label: 'Tier 3',
    color: 'tier3',
    weight: 1.0,
    description: 'Soft signals',
  },
} as const

export const CATEGORY_TIER_MAP: Record<EventCategory, EventTier> = {
  FDA_APPROVAL: 1,
  PDUFA: 1,
  TRIAL_SUCCESS: 1,
  CONTRACT_AWARD: 1,
  REGULATORY_CLEARANCE: 1,
  GUIDANCE_RAISE: 1,
  EARNINGS: 2,
  FOMC: 2,
  CPI: 2,
  NFP: 2,
  PPI: 2,
  ANALYST_UPGRADE: 3,
  CONFERENCE: 3,
  PARTNERSHIP: 3,
  INSIDER_BUYING: 3,
  IPO_LOCKUP: 3,
  SPINOFF: 3,
  M_AND_A: 3,
  GENERIC: 4,
}
