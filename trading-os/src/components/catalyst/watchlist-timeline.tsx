'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CatalystEvent, EventTier } from '@/lib/calendar-types'
import { TierDot } from './event-badge'
import { Zap, Flame, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface WatchlistTimelineProps {
  events: CatalystEvent[]
  watchlistSymbols: string[]
  daysToShow?: number
  onEventClick?: (event: CatalystEvent) => void
}

interface TimelineRow {
  symbol: string
  dayEvents: CatalystEvent[][]
  isMarket?: boolean
}

const tierBgStyles: Record<EventTier, string> = {
  1: 'bg-[oklch(0.65_0.25_25)]',
  2: 'bg-[oklch(0.7_0.18_55)]',
  3: 'bg-[oklch(0.8_0.15_90)]',
  4: 'bg-[oklch(0.7_0.18_145)]',
}

function StackedEventMarkers({ 
  events, 
  onClick 
}: { 
  events: CatalystEvent[]
  onClick?: (event: CatalystEvent) => void 
}) {
  const maxVisible = 3
  const visibleEvents = events.slice(0, maxVisible)
  const overflow = events.length - maxVisible

  if (events.length === 0) {
    return <span className="w-1.5 h-1.5 rounded-full bg-border" aria-hidden="true" />
  }

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onClick?.(events[0])}
            className={cn(
              'flex flex-col items-center gap-0.5 p-1 rounded transition-all',
              'hover:bg-secondary/50 cursor-pointer',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950'
            )}
            aria-label={`${events.length} catalyst${events.length > 1 ? 's' : ''}: ${events.map(e => `${e.symbol} ${e.category.replace(/_/g, ' ')}`).join(', ')}`}
          >
            <div className="flex flex-col items-center gap-0.5">
              {visibleEvents.map((event) => {
                const hasUnusualMove = event.impliedMove && event.avgHistoricalMove && 
                  event.impliedMove > event.avgHistoricalMove * 1.5
                const hasSmartMoney = event.smartMoneyConcentration && event.smartMoneyConcentration >= 3
                
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'w-3 h-3 rounded-full flex items-center justify-center transition-all',
                      tierBgStyles[event.tier],
                    )}
                  >
                    {event.tier === 1 && (
                      <span className="text-[6px] font-bold text-white">!</span>
                    )}
                    {hasUnusualMove && event.tier !== 1 && (
                      <Zap size={7} className="text-background" fill="currentColor" />
                    )}
                    {hasSmartMoney && !hasUnusualMove && event.tier !== 1 && (
                      <Flame size={7} className="text-background" fill="currentColor" />
                    )}
                  </div>
                )
              })}
            </div>
            {overflow > 0 && (
              <span className="text-[9px] font-mono text-muted-foreground font-medium">
                +{overflow}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="max-w-[320px] border border-border bg-panel text-foreground"
        >
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground border-b border-border pb-1">
              {events.length} Catalyst{events.length > 1 ? 's' : ''}
            </div>
            {events.map(event => {
              const hasUnusualMove = event.impliedMove && event.avgHistoricalMove && 
                event.impliedMove > event.avgHistoricalMove * 1.5
              return (
                <div key={event.id} className="flex items-start gap-2">
                  <TierDot tier={event.tier} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-xs">{event.symbol}</span>
                      {event.time && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {event.time}
                        </span>
                      )}
                      {hasUnusualMove && (
                        <Zap size={10} className="text-[oklch(0.85_0.18_90)]" fill="currentColor" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {event.category.replace(/_/g, ' ')} {event.title && `- ${event.title}`}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    T{event.tier}
                  </span>
                </div>
              )
            })}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Mobile collapsed view component
function MobileSymbolList({ 
  symbolRows, 
  onEventClick 
}: { 
  symbolRows: { symbol: string; upcomingEvents: CatalystEvent[] }[]
  onEventClick?: (event: CatalystEvent) => void 
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      {symbolRows.map(({ symbol, upcomingEvents }) => {
        const isExpanded = expanded === symbol
        const displayEvents = isExpanded ? upcomingEvents : upcomingEvents.slice(0, 3)
        
        return (
          <div key={symbol} className="bg-secondary/20 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(isExpanded ? null : symbol)}
              className={cn(
                'w-full flex items-center justify-between p-3',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-inset'
              )}
              aria-expanded={isExpanded}
              aria-label={`${symbol}: ${upcomingEvents.length} upcoming catalysts`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold">{symbol}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {upcomingEvents.length} event{upcomingEvents.length !== 1 ? 's' : ''}
                </span>
              </div>
              {upcomingEvents.length > 3 && (
                isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />
              )}
            </button>
            
            <div className="px-3 pb-3 space-y-1.5">
              {displayEvents.map(event => {
                const eventDate = new Date(event.date)
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                const daysDiff = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                const dayLabel = daysDiff === 0 ? 'Today' : daysDiff === 1 ? 'Tomorrow' : eventDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
                
                return (
                  <button
                    key={event.id}
                    onClick={() => onEventClick?.(event)}
                    className={cn(
                      'w-full flex items-center gap-3 text-left p-2 rounded',
                      'hover:bg-secondary/50 transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-amber-500'
                    )}
                  >
                    <TierDot tier={event.tier} size="md" />
                    <span className="text-xs text-muted-foreground font-mono w-16 shrink-0">
                      {dayLabel}
                    </span>
                    <span className="text-xs truncate flex-1">
                      {event.category.replace(/_/g, ' ')}
                    </span>
                    {event.time && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {event.time}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      
      {symbolRows.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">Add symbols to your watchlist to see catalysts</p>
        </div>
      )}
    </div>
  )
}

export function WatchlistTimeline({ 
  events, 
  watchlistSymbols,
  daysToShow = 7,
  onEventClick,
}: WatchlistTimelineProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [showFullWeek, setShowFullWeek] = useState(false)
  
  const today = useMemo(() => {
    const value = new Date()
    value.setHours(0, 0, 0, 0)
    return value
  }, [])
  
  const { days, symbolRows, mobileRows } = useMemo(() => {
    // Generate days for the timeline
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() + weekOffset * 7)
    
    const daysArray = Array.from({ length: daysToShow }, (_, i) => {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i)
      return d
    })
    
    // Build symbol rows with their events
    const rows: TimelineRow[] = watchlistSymbols.map(symbol => {
      const symbolEvents = events.filter(e => e.symbol === symbol)
      const dayEvents = daysArray.map(day => {
        return symbolEvents.filter(e => {
          const eventDate = new Date(e.date)
          eventDate.setHours(0, 0, 0, 0)
          return eventDate.getTime() === day.getTime()
        })
      })
      return { symbol, dayEvents }
    })
    
    // Market events row
    const marketEvents = events.filter(e => e.symbol === 'SPY')
    const marketDayEvents = daysArray.map(day => {
      return marketEvents.filter(e => {
        const eventDate = new Date(e.date)
        eventDate.setHours(0, 0, 0, 0)
        return eventDate.getTime() === day.getTime()
      })
    })
    
    // For mobile: group upcoming events by symbol
    const mobileSymbolRows = watchlistSymbols.map(symbol => {
      const upcomingEvents = events
        .filter(e => {
          const eventDate = new Date(e.date)
          eventDate.setHours(0, 0, 0, 0)
          return e.symbol === symbol && eventDate >= today
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      return { symbol, upcomingEvents }
    }).filter(row => row.upcomingEvents.length > 0)
    
    return {
      days: daysArray,
      symbolRows: [
        { symbol: 'SPY', dayEvents: marketDayEvents, isMarket: true },
        ...rows.filter(r => r.dayEvents.some(d => d.length > 0)),
      ] as TimelineRow[],
      mobileRows: mobileSymbolRows,
    }
  }, [events, watchlistSymbols, daysToShow, weekOffset, today])
  
  const canGoPrev = weekOffset > 0
  const canGoNext = weekOffset < 4
  
  const hasNoEvents = symbolRows.length <= 1 && !symbolRows[0]?.dayEvents.some(d => d.length > 0)
  
  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Watchlist Timeline</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
            disabled={!canGoPrev}
            className={cn(
              'p-1.5 rounded hover:bg-secondary transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
              !canGoPrev && 'opacity-30 cursor-not-allowed'
            )}
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-muted-foreground font-mono min-w-[80px] text-center">
            {weekOffset === 0 ? 'This Week' : `+${weekOffset} weeks`}
          </span>
          <button
            onClick={() => setWeekOffset(Math.min(4, weekOffset + 1))}
            disabled={!canGoNext}
            className={cn(
              'p-1.5 rounded hover:bg-secondary transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
              !canGoNext && 'opacity-30 cursor-not-allowed'
            )}
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      
      {/* Empty State */}
      {hasNoEvents && watchlistSymbols.length > 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm mb-1">No catalysts scheduled this week</p>
          <p className="text-xs">Try looking at next week or add more symbols</p>
        </div>
      )}
      
      {watchlistSymbols.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm mb-1">Add symbols to your watchlist to see catalysts</p>
          <p className="text-xs">Click the settings icon to manage your watchlist</p>
        </div>
      )}
      
      {/* Desktop Timeline Grid */}
      <div className={cn('hidden md:block', hasNoEvents && 'md:hidden')}>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Day Headers */}
            <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 mb-2" role="row">
              <div className="text-xs text-muted-foreground font-mono" role="columnheader">Symbol</div>
              {days.map((day, i) => {
                const isToday = day.getTime() === today.getTime()
                return (
                  <div 
                    key={i}
                    role="columnheader"
                    className={cn(
                      'text-center text-xs font-mono py-1 rounded',
                      isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <div className="font-medium">
                      {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </div>
                    <div className={cn(isToday ? 'opacity-100' : 'opacity-60')}>
                      {day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                )
              })}
            </div>
            
            {/* Symbol Rows */}
            <div className="space-y-1" role="grid" aria-label="Catalyst timeline">
              {symbolRows.map(({ symbol, dayEvents, isMarket }) => (
                <div 
                  key={symbol}
                  role="row"
                  className={cn(
                    'grid grid-cols-[80px_repeat(7,1fr)] gap-1 items-center',
                    'py-2 rounded-lg transition-colors',
                    isMarket ? 'bg-secondary/30' : 'hover:bg-secondary/20'
                  )}
                >
                  <div 
                    role="rowheader"
                    className={cn(
                      'text-sm font-mono font-semibold px-2',
                      isMarket ? 'text-muted-foreground' : 'text-foreground'
                    )}
                  >
                    {symbol}
                    {isMarket && (
                      <span className="block text-[10px] font-normal opacity-60">MACRO</span>
                    )}
                  </div>
                  
                  {dayEvents.map((eventsForDay, dayIndex) => {
                    const isToday = days[dayIndex].getTime() === today.getTime()
                    return (
                      <div 
                        key={dayIndex}
                        role="gridcell"
                        className={cn(
                          'flex items-center justify-center min-h-[40px] rounded',
                          isToday && 'bg-primary/5'
                        )}
                      >
                        <StackedEventMarkers 
                          events={eventsForDay}
                          onClick={onEventClick}
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Mobile List View */}
      <div className="md:hidden">
        <MobileSymbolList 
          symbolRows={mobileRows}
          onEventClick={onEventClick}
        />
        {mobileRows.length > 0 && (
          <button
            onClick={() => setShowFullWeek(!showFullWeek)}
            className={cn(
              'w-full mt-3 py-2 text-xs text-muted-foreground',
              'hover:text-foreground transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 rounded'
            )}
          >
            {showFullWeek ? 'Show less' : 'Show full week'}
          </button>
        )}
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[oklch(0.65_0.25_25)]" aria-hidden="true" />
          <span>T1 Binary</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[oklch(0.7_0.18_55)]" aria-hidden="true" />
          <span>T1 Quantified</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[oklch(0.8_0.15_90)]" aria-hidden="true" />
          <span>T2</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[oklch(0.7_0.18_145)]" aria-hidden="true" />
          <span>T3</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap size={12} className="text-[oklch(0.85_0.18_90)]" fill="currentColor" aria-hidden="true" />
          <span>Unusual Move</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Flame size={12} className="text-[oklch(0.7_0.18_55)]" fill="currentColor" aria-hidden="true" />
          <span>Smart Money</span>
        </div>
      </div>
    </div>
  )
}
