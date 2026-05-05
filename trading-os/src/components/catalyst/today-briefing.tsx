'use client'

import { useMemo, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { CatalystEvent, EventTier } from '@/lib/calendar-types'
import { EventBadge, TierDot } from './event-badge'
import { Zap, Flame, Star, Bell, LineChart, Search, X } from 'lucide-react'

interface TodayBriefingProps {
  events: CatalystEvent[]
  onEventClick?: (event: CatalystEvent) => void
  onAddToWatchlist?: (event: CatalystEvent) => void
  onSetAlert?: (event: CatalystEvent) => void
  onViewResearch?: (event: CatalystEvent) => void
  tierFilter?: EventTier[]
}

// Move bar component for implied vs historical visualization
function MoveBar({ implied, historical }: { implied: number; historical: number }) {
  const ratio = implied / historical
  const isUnusual = ratio > 1.5
  const maxMove = Math.max(implied, historical) * 1.2
  
  return (
    <div className="flex flex-col gap-0.5 w-24">
      {/* Implied move bar */}
      <div className="relative h-2 bg-muted/30 rounded-full overflow-hidden">
        <div 
          className={cn(
            'absolute left-0 top-0 h-full rounded-full transition-all',
            isUnusual ? 'bg-[oklch(0.85_0.18_90)]' : 'bg-muted-foreground/40'
          )}
          style={{ width: `${(implied / maxMove) * 100}%` }}
        />
        {isUnusual && (
          <Zap 
            size={10} 
            className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[oklch(0.85_0.18_90)]" 
            fill="currentColor"
            aria-hidden="true"
          />
        )}
      </div>
      {/* Historical move bar (muted) */}
      <div className="relative h-1.5 bg-muted/20 rounded-full overflow-hidden">
        <div 
          className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/20"
          style={{ width: `${(historical / maxMove) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono">
        <span className={cn(isUnusual ? 'text-[oklch(0.85_0.18_90)]' : 'text-muted-foreground')}>
          {implied.toFixed(1)}%
        </span>
        <span className="text-muted-foreground/50">
          avg {historical.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

// Countdown component with auto-update
function TimeCountdown({ date, time }: { date: Date; time?: string }) {
  const [now, setNow] = useState(new Date())
  
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000) // Update every minute
    return () => clearInterval(interval)
  }, [])
  
  const eventDate = new Date(date)
  if (time === 'BMO') {
    eventDate.setHours(9, 30, 0, 0)
  } else if (time === 'AMC') {
    eventDate.setHours(16, 0, 0, 0)
  } else if (time && time.includes(':')) {
    const [h, m] = time.split(':').map(Number)
    eventDate.setHours(h, m, 0, 0)
  }
  
  const diffMs = eventDate.getTime() - now.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  const isImminent = diffMins > 0 && diffMins <= 60
  
  let label = ''
  if (diffMins <= 0) {
    label = 'now'
  } else if (diffMins < 60) {
    label = `in ${diffMins}m`
  } else if (diffHours < 24) {
    const mins = diffMins % 60
    label = mins > 0 ? `in ${diffHours}h ${mins}m` : `in ${diffHours}h`
  } else if (diffDays === 1) {
    label = `tomorrow ${time || ''}`
  } else {
    label = `${diffDays} days`
  }
  
  return (
    <div className={cn(
      'flex items-center gap-1 text-xs font-mono min-w-[70px] justify-end',
      isImminent ? 'text-[oklch(0.85_0.18_90)]' : 'text-muted-foreground'
    )}>
      <div className={cn(
        'w-1.5 h-1.5 rounded-full shrink-0',
        isImminent && 'bg-[oklch(0.85_0.18_90)] animate-pulse'
      )} />
      <span>{label}</span>
    </div>
  )
}

function EventRow({ 
  event, 
  onClick,
  onAddToWatchlist,
  onSetAlert,
  onViewResearch,
}: { 
  event: CatalystEvent
  onClick?: () => void
  onAddToWatchlist?: () => void
  onSetAlert?: () => void
  onViewResearch?: () => void
}) {
  const hasSmartMoney = event.smartMoneyConcentration && event.smartMoneyConcentration >= 3

  return (
    <div
      className={cn(
        'group relative flex items-center gap-4 p-3 rounded-lg transition-all text-left',
        'hover:bg-secondary/50',
        event.isWatchlist && 'bg-secondary/30'
      )}
    >
      <button
        onClick={onClick}
        className={cn(
          'flex-1 flex items-center gap-4 text-left',
          'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950 rounded-lg'
        )}
        aria-label={`${event.symbol} ${event.title} - ${event.category.replace(/_/g, ' ')}`}
      >
        <TierDot tier={event.tier} size="lg" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-foreground">
              {event.symbol}
            </span>
            <span className="text-sm text-muted-foreground truncate">
              {event.title}
            </span>
            {event.isWatchlist && (
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
                WATCHLIST
              </span>
            )}
          </div>
          
          {event.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {event.description}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          {/* Implied vs Avg move visual bar */}
          {event.impliedMove && event.avgHistoricalMove && (
            <MoveBar implied={event.impliedMove} historical={event.avgHistoricalMove} />
          )}
          
          {hasSmartMoney && (
            <div className="flex items-center gap-1" title="Smart money concentration">
              <Flame size={14} className="text-[oklch(0.7_0.18_55)]" fill="currentColor" aria-hidden="true" />
              <span className="text-xs font-mono text-[oklch(0.7_0.18_55)]">
                {event.smartMoneyConcentration}x
              </span>
            </div>
          )}
          
          <TimeCountdown date={event.date} time={event.time} />
        </div>
      </button>
      
      {/* Action zone - visible on hover desktop, always visible mobile */}
      <div className={cn(
        'flex items-center gap-1 shrink-0',
        'opacity-0 group-hover:opacity-100 md:transition-opacity',
        'max-md:opacity-100'
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); onAddToWatchlist?.() }}
          className={cn(
            'p-1.5 rounded hover:bg-secondary transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-amber-500'
          )}
          aria-label="Add to watchlist"
          title="Add to watchlist"
        >
          <Star size={14} className={cn(
            'text-muted-foreground hover:text-foreground',
            event.isWatchlist && 'text-primary fill-primary'
          )} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSetAlert?.() }}
          className={cn(
            'p-1.5 rounded hover:bg-secondary transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-amber-500'
          )}
          aria-label="Set alert for 24h before"
          title="Set alert 24h before"
        >
          <Bell size={14} className="text-muted-foreground hover:text-foreground" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onViewResearch?.() }}
          className={cn(
            'p-1.5 rounded hover:bg-secondary transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-amber-500'
          )}
          aria-label="View research"
          title="View research"
        >
          <LineChart size={14} className="text-muted-foreground hover:text-foreground" />
        </button>
      </div>
    </div>
  )
}

// Filter bar component
function FilterBar({ 
  searchQuery,
  onSearchChange,
  activeTiers,
  onTierToggle,
  activeCategories,
  onCategoryToggle,
}: {
  searchQuery: string
  onSearchChange: (query: string) => void
  activeTiers: EventTier[]
  onTierToggle: (tier: EventTier) => void
  activeCategories: string[]
  onCategoryToggle: (category: string) => void
}) {
  const tiers: { tier: EventTier; label: string }[] = [
    { tier: 1, label: 'T1' },
    { tier: 2, label: 'T2' },
    { tier: 3, label: 'T3' },
    { tier: 4, label: 'T4' },
  ]
  
  const categories = ['Earnings', 'FOMC', 'PDUFA', 'Analyst', 'Macro']
  const activeFilterCount = activeTiers.length + activeCategories.length
  
  return (
    <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border mb-4">
      {/* Search input */}
      <div className="relative flex-1 min-w-[150px] max-w-[200px]">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search symbol..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className={cn(
            'w-full pl-8 pr-3 py-1.5 text-xs rounded-lg',
            'bg-secondary/50 border border-border',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-amber-500'
          )}
        />
      </div>
      
      {/* Tier chips */}
      <div className="flex items-center gap-1">
        {tiers.map(({ tier, label }) => (
          <button
            key={tier}
            onClick={() => onTierToggle(tier)}
            className={cn(
              'px-2 py-1 text-[10px] font-mono rounded transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500',
              activeTiers.includes(tier)
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      
      {/* Category chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {categories.map(category => (
          <button
            key={category}
            onClick={() => onCategoryToggle(category)}
            className={cn(
              'px-2 py-1 text-[10px] rounded transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500',
              activeCategories.includes(category)
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'
            )}
          >
            {category}
          </button>
        ))}
      </div>
      
      {/* Active filter badge */}
      {activeFilterCount > 0 && (
        <button
          onClick={() => {
            activeTiers.forEach(t => onTierToggle(t))
            activeCategories.forEach(c => onCategoryToggle(c))
            onSearchChange('')
          }}
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-[10px] rounded',
            'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-amber-500'
          )}
        >
          <span>{activeFilterCount} active</span>
          <X size={10} />
        </button>
      )}
    </div>
  )
}

export function TodayBriefing({ 
  events, 
  onEventClick,
  onAddToWatchlist,
  onSetAlert,
  onViewResearch,
  tierFilter = [],
}: TodayBriefingProps) {
  const today = useMemo(() => {
    const value = new Date()
    value.setHours(0, 0, 0, 0)
    return value
  }, [])
  
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTiers, setActiveTiers] = useState<EventTier[]>(tierFilter)
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  
  const handleTierToggle = (tier: EventTier) => {
    setActiveTiers(prev => 
      prev.includes(tier) ? prev.filter(t => t !== tier) : [...prev, tier]
    )
  }
  
  const handleCategoryToggle = (category: string) => {
    setActiveCategories(prev => 
      prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]
    )
  }
  
  const { bmo, duringSession, amc, upcoming, nextCatalyst } = useMemo(() => {
    // Apply filters
    let filteredEvents = events
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filteredEvents = filteredEvents.filter(e => 
        e.symbol.toLowerCase().includes(q) || 
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      )
    }
    
    if (activeTiers.length > 0) {
      filteredEvents = filteredEvents.filter(e => activeTiers.includes(e.tier))
    }
    
    if (activeCategories.length > 0) {
      filteredEvents = filteredEvents.filter(e => {
        const cat = e.category.toLowerCase()
        return activeCategories.some(c => cat.includes(c.toLowerCase()))
      })
    }
    
    const todayEvents = filteredEvents.filter(e => {
      const eventDate = new Date(e.date)
      eventDate.setHours(0, 0, 0, 0)
      return eventDate.getTime() === today.getTime()
    })
    
    const upcomingEvents = filteredEvents
      .filter(e => {
        const eventDate = new Date(e.date)
        eventDate.setHours(0, 0, 0, 0)
        return eventDate.getTime() > today.getTime()
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5)
    
    // Find next catalyst for empty state
    const next = events
      .filter(e => new Date(e.date) > today)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
    
    return {
      bmo: todayEvents.filter(e => e.time === 'BMO'),
      duringSession: todayEvents.filter(e => e.time && e.time !== 'BMO' && e.time !== 'AMC'),
      amc: todayEvents.filter(e => e.time === 'AMC' || !e.time),
      upcoming: upcomingEvents,
      nextCatalyst: next,
    }
  }, [events, today, searchQuery, activeTiers, activeCategories])
  
  const formattedDate = today.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  
  const hasNoEventsToday = bmo.length === 0 && duringSession.length === 0 && amc.length === 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Today</h2>
        <p className="text-sm text-muted-foreground font-mono">{formattedDate}</p>
      </div>
      
      {/* Filter Bar */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeTiers={activeTiers}
        onTierToggle={handleTierToggle}
        activeCategories={activeCategories}
        onCategoryToggle={handleCategoryToggle}
      />
      
      {/* Empty state for no events today */}
      {hasNoEventsToday && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm mb-2">Quiet day. No catalysts scheduled.</p>
          {nextCatalyst && (
            <p className="text-xs">
              Next catalyst: <span className="font-mono font-medium text-foreground">{nextCatalyst.symbol}</span>{' '}
              on {new Date(nextCatalyst.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>
      )}
      
      {/* Before Market Open */}
      {bmo.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[oklch(0.7_0.18_55)]" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Before Open
            </h3>
            <span className="text-xs text-muted-foreground/60 font-mono">
              ({bmo.length})
            </span>
          </div>
          <div className="space-y-1" role="list" aria-label="Before market open events">
            {bmo.map(event => (
              <EventRow 
                key={event.id} 
                event={event} 
                onClick={() => onEventClick?.(event)}
                onAddToWatchlist={() => onAddToWatchlist?.(event)}
                onSetAlert={() => onSetAlert?.(event)}
                onViewResearch={() => onViewResearch?.(event)}
              />
            ))}
          </div>
        </section>
      )}
      
      {/* During Session */}
      {duringSession.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[oklch(0.8_0.15_90)]" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              During Session
            </h3>
            <span className="text-xs text-muted-foreground/60 font-mono">
              ({duringSession.length})
            </span>
          </div>
          <div className="space-y-1" role="list" aria-label="During session events">
            {duringSession.map(event => (
              <EventRow 
                key={event.id} 
                event={event} 
                onClick={() => onEventClick?.(event)}
                onAddToWatchlist={() => onAddToWatchlist?.(event)}
                onSetAlert={() => onSetAlert?.(event)}
                onViewResearch={() => onViewResearch?.(event)}
              />
            ))}
          </div>
        </section>
      )}
      
      {/* After Market Close */}
      {amc.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[oklch(0.65_0.25_25)]" aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              After Close
            </h3>
            <span className="text-xs text-muted-foreground/60 font-mono">
              ({amc.length})
            </span>
          </div>
          <div className="space-y-1" role="list" aria-label="After close events">
            {amc.map(event => (
              <EventRow 
                key={event.id} 
                event={event} 
                onClick={() => onEventClick?.(event)}
                onAddToWatchlist={() => onAddToWatchlist?.(event)}
                onSetAlert={() => onSetAlert?.(event)}
                onViewResearch={() => onViewResearch?.(event)}
              />
            ))}
          </div>
        </section>
      )}
      
      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Upcoming
            </h3>
          </div>
          <div className="space-y-2" role="list" aria-label="Upcoming events">
            {upcoming.map(event => {
              const eventDate = new Date(event.date)
              const daysDiff = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
              const dayLabel = daysDiff === 1 ? 'Tomorrow' : eventDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              
              return (
                <div 
                  key={event.id}
                  className="flex items-center gap-3 text-sm"
                  role="listitem"
                >
                  <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">
                    {dayLabel}
                  </span>
                  <EventBadge 
                    event={event} 
                    size="sm"
                    onClick={() => onEventClick?.(event)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
