import type { CatalystEvent, DayEvents, EventCategory } from './calendar-types'

type RawCatalystEvent = {
  id: string
  symbol: string
  title: string
  category: EventCategory
  tier: 1 | 2 | 3 | 4
  date: string
  time?: string
  impliedMove?: number | null
  avgHistoricalMove?: number | null
  smartMoneyConcentration?: number | null
  description?: string | null
  isWatchlist?: boolean
}

type EventsResponse = {
  events: RawCatalystEvent[]
  meta: {
    total: number
    from: string
    to: string
  }
}

type HeatmapResponse = {
  month: string
  days: Array<{
    date: string
    events: Array<{ id: string; symbol: string; tier: 1 | 2 | 3 | 4 }>
    heatIntensity: number
  }>
}

type TodayResponse = {
  date: string
  bmo: RawCatalystEvent[]
  intraday: RawCatalystEvent[]
  amc: RawCatalystEvent[]
  other: RawCatalystEvent[]
}

type WatchlistResponse = {
  symbols: string[]
  source: string
  updated_at: string
}

export type CalendarEventDetail = CatalystEvent & {
  sourceUrl?: string | null
  metadata?: Record<string, unknown>
  relatedEvents: CatalystEvent[]
}

function toDate(value: string): Date {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function normalizeEvent(event: RawCatalystEvent): CatalystEvent {
  return {
    id: String(event.id),
    symbol: event.symbol || '',
    title: event.title || '',
    category: event.category,
    tier: event.tier,
    date: toDate(event.date),
    time: event.time || undefined,
    impliedMove: event.impliedMove ?? undefined,
    avgHistoricalMove: event.avgHistoricalMove ?? undefined,
    smartMoneyConcentration: event.smartMoneyConcentration ?? undefined,
    description: event.description ?? undefined,
    isWatchlist: Boolean(event.isWatchlist),
  }
}

async function readJson<T>(input: string): Promise<T> {
  const response = await fetch(input, {
    method: 'GET',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Calendar API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    searchParams.set(key, String(value))
  })
  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

export async function fetchCalendarEvents(params: {
  from: string
  to: string
  limit?: number
  watchlistOnly?: boolean
}) {
  const query = buildQuery(params)
  const response = await readJson<EventsResponse>(`/api/calendar/events${query}`)
  return response.events.map(normalizeEvent)
}

export async function fetchCalendarEventDetail(id: string) {
  const response = await readJson<RawCatalystEvent & {
    source_url?: string | null
    metadata?: Record<string, unknown>
    related_events?: RawCatalystEvent[]
  }>(`/api/calendar/events/${id}`)

  return {
    ...normalizeEvent(response),
    sourceUrl: response.source_url ?? null,
    metadata: response.metadata ?? {},
    relatedEvents: (response.related_events || []).map(normalizeEvent),
  } satisfies CalendarEventDetail
}

export async function fetchCalendarHeatmap(month: string): Promise<DayEvents[]> {
  const response = await readJson<HeatmapResponse>(`/api/calendar/heatmap${buildQuery({ month })}`)
  return response.days.map((day) => ({
    date: toDate(`${day.date}T00:00:00.000Z`),
    events: day.events.map((event) => ({
      id: event.id,
      symbol: event.symbol,
      title: event.symbol || 'Market Event',
      category: 'GENERIC',
      tier: event.tier,
      date: toDate(`${day.date}T00:00:00.000Z`),
    })),
    heatIntensity: day.heatIntensity,
  }))
}

export async function fetchTodayCalendar() {
  const response = await readJson<TodayResponse>('/api/calendar/today')
  return {
    date: toDate(`${response.date}T00:00:00.000Z`),
    bmo: response.bmo.map(normalizeEvent),
    intraday: response.intraday.map(normalizeEvent),
    amc: response.amc.map(normalizeEvent),
    other: response.other.map(normalizeEvent),
  }
}

export async function fetchWatchlistSymbols() {
  const response = await readJson<WatchlistResponse>('/api/watchlist')
  return response.symbols
}