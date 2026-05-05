'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calendar, Clock, Filter, LayoutGrid, Settings, X, Zap } from 'lucide-react'

import { CalendarHeatmap } from '@/components/catalyst/calendar-heatmap'
import { EventDetailModal } from '@/components/catalyst/event-detail-modal'
import { TodayBriefing } from '@/components/catalyst/today-briefing'
import { WatchlistTimeline } from '@/components/catalyst/watchlist-timeline'
import { mockEvents, watchlistSymbols } from '@/lib/calendar-mock-data'
import { fetchCalendarEvents, fetchWatchlistSymbols } from '@/lib/calendar-api'
import type { CatalystEvent, EventTier } from '@/lib/calendar-types'
import { cn } from '@/lib/utils'

type ViewMode = 'timeline' | 'today' | 'calendar'
type KPIFilter = 'today' | 'tier1' | 'watching' | null

function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-gradient-to-r from-slate-800 to-slate-700', className)} />
}

function Next24HoursStrip({
  events,
  onEventClick,
}: {
  events: CatalystEvent[]
  onEventClick: (event: CatalystEvent) => void
}) {
  const upcomingEvents = useMemo(() => {
    const now = new Date()
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    return events
      .filter((event) => {
        const eventDate = new Date(event.date)
        if (event.time === 'BMO') {
          eventDate.setHours(9, 30, 0, 0)
        } else if (event.time === 'AMC') {
          eventDate.setHours(16, 0, 0, 0)
        } else if (event.time && event.time.includes(':')) {
          const [hours, minutes] = event.time.split(':').map(Number)
          eventDate.setHours(hours, minutes, 0, 0)
        }
        return eventDate > now && eventDate <= next24h
      })
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  }, [events])

  if (upcomingEvents.length === 0) {
    return null
  }

  const tierColors: Record<EventTier, string> = {
    1: 'border-[oklch(0.65_0.25_25/0.4)] bg-[oklch(0.65_0.25_25/0.2)]',
    2: 'border-[oklch(0.7_0.18_55/0.4)] bg-[oklch(0.7_0.18_55/0.2)]',
    3: 'border-[oklch(0.8_0.15_90/0.3)] bg-[oklch(0.8_0.15_90/0.15)]',
    4: 'border-[oklch(0.7_0.18_145/0.3)] bg-[oklch(0.7_0.18_145/0.15)]',
  }

  const tierDots: Record<EventTier, string> = {
    1: 'bg-[oklch(0.65_0.25_25)]',
    2: 'bg-[oklch(0.7_0.18_55)]',
    3: 'bg-[oklch(0.8_0.15_90)]',
    4: 'bg-[oklch(0.7_0.18_145)]',
  }

  return (
    <div className="border-b border-border bg-panel">
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-3 py-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Next 24h
          </span>
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-center gap-2">
              {upcomingEvents.map((event) => {
                const now = new Date()
                const eventDate = new Date(event.date)
                const diffMs = eventDate.getTime() - now.getTime()
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
                const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
                const timeLabel = diffHours > 0 ? `${diffHours}h ${diffMins}m` : `${diffMins}m`

                return (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 transition-all hover:brightness-110',
                      'focus:outline-none focus:ring-2 focus:ring-amber-500',
                      tierColors[event.tier],
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', tierDots[event.tier])} />
                    <span className="text-xs font-mono font-medium">{event.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">{event.time}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{timeLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Tier1AlertBanner({
  events,
  onDismiss,
  onEventClick,
}: {
  events: CatalystEvent[]
  onDismiss: () => void
  onEventClick: (event: CatalystEvent) => void
}) {
  const imminentTier1 = useMemo(() => {
    const now = new Date()
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    return events.filter((event) => {
      const eventDate = new Date(event.date)
      return event.tier === 1 && event.isWatchlist && eventDate <= in48h && eventDate > now
    })
  }, [events])

  if (imminentTier1.length === 0) {
    return null
  }

  const now = new Date()
  const event = imminentTier1[0]
  const eventDate = new Date(event.date)
  const diffHours = Math.floor((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60))
  const timeLabel = diffHours < 24 ? `${diffHours}h` : `tomorrow ${event.time || ''}`

  return (
    <div className="border-b border-[oklch(0.85_0.18_90/0.3)] bg-[oklch(0.85_0.18_90/0.15)]">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between py-2">
          <button
            onClick={() => onEventClick(event)}
            className={cn('flex items-center gap-2 rounded text-sm', 'focus:outline-none focus:ring-2 focus:ring-amber-500')}
          >
            <AlertTriangle size={16} className="text-[oklch(0.85_0.18_90)]" />
            <span className="font-mono font-semibold text-[oklch(0.85_0.18_90)]">{event.symbol}</span>
            <span className="text-muted-foreground">{event.category.replace(/_/g, ' ')} {timeLabel}</span>
            {event.impliedMove && (
              <span className="font-mono text-[oklch(0.85_0.18_90)]">- implied move {event.impliedMove.toFixed(1)}%</span>
            )}
          </button>
          <button
            onClick={onDismiss}
            className={cn('rounded p-1 transition-colors hover:bg-secondary/50', 'focus:outline-none focus:ring-2 focus:ring-amber-500')}
            aria-label="Dismiss alert"
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  )
}

function KPICounter({
  value,
  label,
  isActive,
  onClick,
  onClear,
  colorClass,
}: {
  value: number
  label: string
  isActive: boolean
  onClick: () => void
  onClear: () => void
  colorClass?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative rounded-lg px-3 py-1 text-center transition-all',
        'focus:outline-none focus:ring-2 focus:ring-amber-500',
        isActive ? 'border-b-2 border-primary bg-primary/10' : 'hover:bg-secondary/50',
      )}
      aria-pressed={isActive}
      aria-label={`Filter by ${label}: ${value}`}
    >
      <div className={cn('text-lg font-mono font-bold', colorClass)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {isActive && (
        <button
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label={`Clear ${label} filter`}
        >
          <X size={10} />
        </button>
      )}
    </button>
  )
}

export default function EventsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [selectedEvent, setSelectedEvent] = useState<CatalystEvent | null>(null)
  const [filterWatchlist, setFilterWatchlist] = useState(false)
  const [kpiFilter, setKpiFilter] = useState<KPIFilter>(null)
  const [showTier1Alert, setShowTier1Alert] = useState(true)
  const [events, setEvents] = useState<CatalystEvent[]>([])
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isActive = true

    const formatDate = (value: Date) => value.toISOString().slice(0, 10)
    const addDays = (value: Date, days: number) => {
      const result = new Date(value)
      result.setDate(result.getDate() + days)
      return result
    }

    async function loadCalendar() {
      setIsLoading(true)

      try {
        const now = new Date()
        const [liveEvents, liveWatchlist] = await Promise.all([
          fetchCalendarEvents({
            from: formatDate(now),
            to: formatDate(addDays(now, 30)),
            limit: 300,
          }),
          fetchWatchlistSymbols(),
        ])

        if (!isActive) {
          return
        }

        setEvents(liveEvents)
        setWatchlist(liveWatchlist)
        setLoadError(null)
      } catch {
        if (!isActive) {
          return
        }

        setEvents(mockEvents)
        setWatchlist(watchlistSymbols)
        setLoadError('Live calendar unavailable. Showing fallback data.')
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadCalendar()

    return () => {
      isActive = false
    }
  }, [])

  const today = useMemo(() => {
    const value = new Date()
    value.setHours(0, 0, 0, 0)
    return value
  }, [])
  const weekFromNow = useMemo(() => new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), [today])

  const todayCount = events.filter((event) => new Date(event.date).toDateString() === today.toDateString()).length
  const tier1Count = events.filter((event) => {
    const eventDate = new Date(event.date)
    eventDate.setHours(0, 0, 0, 0)
    return event.tier === 1 && eventDate >= today && eventDate <= weekFromNow
  }).length
  const watchlistCount = watchlist.length

  const filteredEvents = useMemo(() => {
    let filtered = events

    if (filterWatchlist) {
      filtered = filtered.filter((event) => event.isWatchlist || event.symbol === 'SPY' || event.symbol === '')
    }

    if (kpiFilter === 'today') {
      filtered = filtered.filter((event) => new Date(event.date).toDateString() === today.toDateString())
    } else if (kpiFilter === 'tier1') {
      filtered = filtered.filter((event) => {
        const eventDate = new Date(event.date)
        eventDate.setHours(0, 0, 0, 0)
        return event.tier === 1 && eventDate >= today && eventDate <= weekFromNow
      })
    } else if (kpiFilter === 'watching') {
      filtered = filtered.filter((event) => event.isWatchlist)
    }

    return filtered
  }, [events, filterWatchlist, kpiFilter, today, weekFromNow])

  const handleKpiClick = (filter: KPIFilter) => {
    setKpiFilter((previous) => (previous === filter ? null : filter))
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b border-border bg-background/95">
          <div className="container mx-auto px-4">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-3">
                <LoadingSkeleton className="h-8 w-8 rounded-lg" />
                <div>
                  <LoadingSkeleton className="mb-1 h-5 w-32" />
                  <LoadingSkeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="hidden items-center gap-6 md:flex">
                <LoadingSkeleton className="h-10 w-12" />
                <LoadingSkeleton className="h-10 w-12" />
                <LoadingSkeleton className="h-10 w-12" />
              </div>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-6">
          <div className="space-y-6">
            <LoadingSkeleton className="h-64 w-full rounded-xl" />
            <div className="grid gap-6 md:grid-cols-2">
              <LoadingSkeleton className="h-80 rounded-xl" />
              <LoadingSkeleton className="h-80 rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {showTier1Alert && (
        <Tier1AlertBanner
          events={events}
          onDismiss={() => setShowTier1Alert(false)}
          onEventClick={setSelectedEvent}
        />
      )}

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Zap size={18} className="text-primary-foreground" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-semibold tracking-tight">Catalyst Calendar</h1>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">OpenRange</p>
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <KPICounter
                value={todayCount}
                label="Today"
                isActive={kpiFilter === 'today'}
                onClick={() => handleKpiClick('today')}
                onClear={() => setKpiFilter(null)}
              />
              <KPICounter
                value={tier1Count}
                label="Tier 1 (7d)"
                isActive={kpiFilter === 'tier1'}
                onClick={() => handleKpiClick('tier1')}
                onClear={() => setKpiFilter(null)}
                colorClass="text-[oklch(0.65_0.25_25)]"
              />
              <KPICounter
                value={watchlistCount}
                label="Watching"
                isActive={kpiFilter === 'watching'}
                onClick={() => handleKpiClick('watching')}
                onClear={() => setKpiFilter(null)}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterWatchlist(!filterWatchlist)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
                  filterWatchlist ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80',
                )}
                aria-pressed={filterWatchlist}
              >
                <Filter size={14} aria-hidden="true" />
                <span className="hidden sm:inline">Watchlist</span>
              </button>
              <button
                className={cn(
                  'rounded-lg p-2 transition-colors hover:bg-secondary',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
                )}
                aria-label="Settings"
              >
                <Settings size={18} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="border-b border-[oklch(0.65_0.25_25/0.25)] bg-[oklch(0.65_0.25_25/0.1)]">
          <div className="container mx-auto px-4 py-2 text-xs font-medium text-[oklch(0.82_0.12_40)]">
            {loadError}
          </div>
        </div>
      )}

      <Next24HoursStrip events={events} onEventClick={setSelectedEvent} />

      <div className="border-b border-border bg-panel">
        <div className="container mx-auto px-4">
          <div className="-mb-px flex items-center gap-1" role="tablist">
            {[
              { id: 'timeline', label: 'Timeline', icon: LayoutGrid },
              { id: 'today', label: 'Today', icon: Clock },
              { id: 'calendar', label: 'Calendar', icon: Calendar },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setViewMode(id as ViewMode)}
                role="tab"
                aria-selected={viewMode === id}
                aria-controls={`${id}-panel`}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset',
                  viewMode === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:border-muted hover:text-foreground',
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-6">
        {viewMode === 'timeline' && (
          <div className="space-y-8" id="timeline-panel" role="tabpanel">
            <section className="rounded-xl border border-border bg-panel p-4 md:p-6">
              <WatchlistTimeline events={filteredEvents} watchlistSymbols={watchlist} onEventClick={setSelectedEvent} />
            </section>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="rounded-xl border border-border bg-panel p-4 md:p-6">
                <TodayBriefing events={filteredEvents} onEventClick={setSelectedEvent} tierFilter={kpiFilter === 'tier1' ? [1] : []} />
              </section>

              <section className="rounded-xl border border-border bg-panel p-4 md:p-6">
                <CalendarHeatmap
                  events={filteredEvents}
                  onDayClick={(_date, events) => {
                    if (events.length > 0) {
                      setSelectedEvent(events[0])
                    }
                  }}
                />
              </section>
            </div>
          </div>
        )}

        {viewMode === 'today' && (
          <div className="mx-auto max-w-2xl" id="today-panel" role="tabpanel">
            <section className="rounded-xl border border-border bg-panel p-4 md:p-6">
              <TodayBriefing events={filteredEvents} onEventClick={setSelectedEvent} tierFilter={kpiFilter === 'tier1' ? [1] : []} />
            </section>
          </div>
        )}

        {viewMode === 'calendar' && (
          <div className="grid gap-6 lg:grid-cols-3" id="calendar-panel" role="tabpanel">
            <section className="rounded-xl border border-border bg-panel p-4 md:p-6 lg:col-span-2">
              <CalendarHeatmap
                events={filteredEvents}
                onDayClick={(_date, events) => {
                  if (events.length > 0) {
                    setSelectedEvent(events[0])
                  }
                }}
              />
            </section>

            <section className="rounded-xl border border-border bg-panel p-4 md:p-6">
              <TodayBriefing events={filteredEvents} onEventClick={setSelectedEvent} tierFilter={kpiFilter === 'tier1' ? [1] : []} />
            </section>
          </div>
        )}
      </main>

      <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}